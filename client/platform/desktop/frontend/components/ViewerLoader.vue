<script lang="ts">
import npath from 'path';
import {
  computed, defineComponent, ref, watch, onMounted, onBeforeUnmount, nextTick,
} from 'vue';
import Viewer from 'dive-common/components/Viewer.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common//components/ImportAnnotations.vue';
import SidebarContext from 'dive-common/components/SidebarContext.vue';
import context from 'dive-common/store/context';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { SegmentationPredictRequest } from 'dive-common/apispec';
import { clientSettings } from 'dive-common/store/settings';
import type { StereoAnnotationCompleteParams } from 'dive-common/use/useModeManager';
import {
  segmentationPredict, segmentationInitialize, segmentationIsReady, loadMetadata, textQuery,
  runTextQueryPipeline,
  stereoEnable, stereoDisable, stereoSetFrame, stereoTransferLine, stereoTransferPoints,
  onStereoDisparityReady, onStereoDisparityError,
} from 'platform/desktop/frontend/api';
import Export from './Export.vue';
import JobTab from './JobTab.vue';
import { datasets } from '../store/dataset';
import { settings } from '../store/settings';
import { runningJobs } from '../store/jobs';

const buttonOptions = {
  outlined: true,
  color: 'grey lighten-1',
  depressed: true,
  text: true,
  class: ['mx-1'],
};
const menuOptions = {
  offsetY: true,
};
export default defineComponent({
  components: {
    Export,
    JobTab,
    RunPipelineMenu,
    SidebarContext,
    Viewer,
    ImportAnnotations,
    ...context.getComponents(),
  },
  props: {
    id: { // always the base ID
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { prompt } = usePrompt();
    const viewerRef = ref();
    const subTypeList = computed(() => [datasets.value[props.id]?.subType || null]);
    const camNumbers = computed(() => [datasets.value[props.id]?.cameraNumber || 1]);
    const readonlyMode = computed(() => settings.value?.readonlyMode || false);
    const selectedCamera = ref('');
    watch(runningJobs, async (_previous, current) => {
      // Check the current props.id so multicam files also trigger a reload
      const currentJob = current.find((item) => item.job.datasetIds.reduce((prev, datasetId) => (datasetId.includes(props.id) ? datasetId : prev), ''));
      if (currentJob && currentJob.job.jobType === 'pipeline') {
        if (currentJob.job.exitCode === 0) {
          const result = await prompt({
            title: 'Pipeline Finished',
            text: [`Pipeline: ${currentJob.job.title}`,
              'finished running successfully on the current dataset.  Click reload to load the annotations.  The current annotations will be replaced with the pipeline output.',
            ],
            confirm: true,
            positiveButton: 'Reload',
            negativeButton: 'Cancel',
          });
          if (result) {
            viewerRef.value.reloadAnnotations();
          }
        } else {
          await prompt({
            title: 'Pipeline Incomplete',
            text: [`Pipeline: ${currentJob.job.title}`,
              'either failed or was cancelled by the user',
            ],
          });
        }
      }
    });
    function changeCamera(cameraName: string) {
      selectedCamera.value = cameraName;
    }
    // When using multiCam some elements require a modified ID to be used
    const modifiedId = computed(() => {
      if (selectedCamera.value) {
        return `${props.id}/${selectedCamera.value}`;
      }
      return props.id;
    });
    const readOnlyMode = computed(() => settings.value?.readonlyMode || false);
    const runningPipelines = computed(() => {
      const results: string[] = [];
      // Check if any running job contains the root props.id
      // for multicam this is why we use the reduce to check each id
      if (runningJobs.value.find(
        (item) => item.job.datasetIds.reduce((prev: boolean, current) => (current.includes(props.id) && prev), true),
      )) {
        results.push(props.id);
      }
      return results;
    });

    async function largeImageWarning() {
      await prompt({
        title: 'Large Image Warning',
        text: ['The current Image Sequence dataset has a large resolution',
          'This may prevent the image from being shown on certain hardware/browsers',
        ],
        positiveButton: 'Okay',
      });
    }

    /**
     * Initialize segmentation recipe with platform-specific functions
     */
    async function initializeSegmentation() {
      await nextTick(); // Wait for Viewer to be mounted
      if (!viewerRef.value?.segmentationRecipe) {
        return;
      }

      try {
        // Load metadata to get image paths
        const meta = await loadMetadata(props.id);
        const { originalBasePath, originalImageFiles, type } = meta;

        // Create image path getter based on dataset type
        const getImagePath = (frameNum: number): string => {
          if (type === 'video') {
            // For video, we need to extract frames - this is more complex
            // For now, return the video path (segmentation would need frame extraction)
            return npath.join(originalBasePath, meta.originalVideoFile);
          }
          // For image sequences, return the image file path
          if (originalImageFiles && originalImageFiles[frameNum]) {
            const imagePath = originalImageFiles[frameNum];
            // Handle both relative and absolute paths
            if (npath.isAbsolute(imagePath)) {
              return imagePath;
            }
            return npath.join(originalBasePath, imagePath);
          }
          return '';
        };

        // Initialize the recipe
        // Desktop uses imagePath from the request, so we ignore the frameNum parameter
        viewerRef.value.segmentationRecipe.initialize({
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          predictFn: (request: SegmentationPredictRequest, _frameNum: number) => segmentationPredict(request),
          getImagePath,
          // Initialize the segmentation service when the recipe is activated (user clicks Segment button)
          // Check if already ready to avoid showing loading indicator unnecessarily
          initializeServiceFn: async () => {
            const status = await segmentationIsReady();
            if (status.ready) {
              return;
            }
            await segmentationInitialize();
          },
        });
      } catch {
        // Segmentation initialization failed - recipe will not be available
      }
    }

    // Store metadata for text query image path resolution
    let cachedMeta: {
      originalBasePath: string;
      originalImageFiles: string[];
      type: string;
      originalVideoFile?: string;
    } | null = null;

    /**
     * Get image path for a given frame number
     */
    function getImagePathForFrame(frameNum: number): string {
      if (!cachedMeta) {
        return '';
      }
      const { originalBasePath, originalImageFiles, type } = cachedMeta;
      if (type === 'video') {
        // Video datasets require frame extraction - not yet supported
        return npath.join(originalBasePath, cachedMeta.originalVideoFile || '');
      }
      if (originalImageFiles && originalImageFiles[frameNum]) {
        const imagePath = originalImageFiles[frameNum];
        if (npath.isAbsolute(imagePath)) {
          return imagePath;
        }
        return npath.join(originalBasePath, imagePath);
      }
      return '';
    }

    /**
     * Handle text query submission from Viewer
     */
    async function handleTextQuerySubmit(params: {
      text: string;
      boxThreshold: number;
      frameNum: number;
    }) {
      const { text, boxThreshold, frameNum } = params;

      // Ensure metadata is loaded
      if (!cachedMeta) {
        try {
          const meta = await loadMetadata(props.id);
          cachedMeta = {
            originalBasePath: meta.originalBasePath,
            originalImageFiles: meta.originalImageFiles,
            type: meta.type,
            originalVideoFile: meta.originalVideoFile,
          };
        } catch {
          await prompt({
            title: 'Text Query Error',
            text: ['Failed to load dataset metadata for text query.'],
          });
          return;
        }
      }

      const imagePath = getImagePathForFrame(frameNum);
      if (!imagePath) {
        await prompt({
          title: 'Text Query Error',
          text: ['Could not determine image path for current frame.'],
        });
        return;
      }

      try {
        const response = await textQuery({
          imagePath,
          text,
          boxThreshold,
          maxDetections: 10,
        });

        if (!response.success) {
          throw new Error(response.error || 'Text query failed');
        }

        const detections = response.detections || [];

        if (detections.length === 0) {
          await prompt({
            title: 'Text Query Results',
            text: [`No objects matching "${text}" were found in the current frame.`],
          });
          return;
        }

        // Create tracks from detections
        if (viewerRef.value) {
          const { cameraStore } = viewerRef.value;
          const selectedCamera = viewerRef.value.selectedCamera || 'singleCam';
          const trackStore = cameraStore.camMap.value.get(selectedCamera)?.trackStore;

          if (!trackStore) {
            await prompt({
              title: 'Text Query Error',
              text: ['Could not create tracks - trackStore not found.'],
            });
            return;
          }

          detections.forEach((det) => {
            // Get a new unique track ID
            const newTrackId = cameraStore.getNewTrackId();

            // Create a new track with the detection label as its type
            const newTrack = trackStore.add(
              frameNum,
              det.label, // Use the detection label as the track type
              undefined, // No parent track
              newTrackId, // Use the new track ID
            );

            // Calculate bounds from box [x1, y1, x2, y2]
            const [x1, y1, x2, y2] = det.box;
            const bounds = [x1, y1, x2, y2] as [number, number, number, number];

            // Create GeoJSON features array for polygon if available
            const geoJsonFeatures: GeoJSON.Feature[] = [];
            if (det.polygon && det.polygon.length >= 3) {
              // Ensure polygon is closed (first point = last point for GeoJSON)
              const closedPolygon = [...det.polygon];
              const first = closedPolygon[0];
              const last = closedPolygon[closedPolygon.length - 1];
              if (first[0] !== last[0] || first[1] !== last[1]) {
                closedPolygon.push([...first] as [number, number]);
              }

              const polygonFeature: GeoJSON.Feature = {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [closedPolygon],
                },
                properties: { key: '' },
              };
              geoJsonFeatures.push(polygonFeature);
            }

            // Set the feature with bounds and optional polygon
            newTrack.setFeature({
              frame: frameNum,
              flick: 0,
              keyframe: true,
              bounds,
              interpolate: false, // Single detection, no interpolation
            }, geoJsonFeatures.length > 0 ? geoJsonFeatures : undefined);
          });

          await prompt({
            title: 'Text Query Results',
            text: [`Created ${detections.length} tracks for objects matching "${text}".`],
          });
        }
      } catch (error) {
        await prompt({
          title: 'Text Query Error',
          text: [`Failed to execute text query: ${error}`],
        });
      }
    }

    // Initialize segmentation when component is mounted
    onMounted(() => {
      initializeSegmentation();
    });

    /**
     * Handle text query service initialization request
     * Called when user opens the text query dialog
     */
    async function handleTextQueryInit() {
      try {
        // Check if the service is already ready
        const status = await segmentationIsReady();
        if (status.ready) {
          viewerRef.value?.onTextQueryServiceReady(true);
          return;
        }

        // Try to initialize the service
        await segmentationInitialize();
        viewerRef.value?.onTextQueryServiceReady(true);
      } catch (error) {
        // Provide text-query specific error message instead of generic segmentation error
        const rawMessage = error instanceof Error ? error.message : '';
        const errorMessage = rawMessage.toLowerCase().includes('segmentation')
          ? 'Unable to load text query model. Please ensure the service is properly configured.'
          : (rawMessage || 'Text query model is not available. Please ensure the service is properly configured.');
        viewerRef.value?.onTextQueryServiceReady(false, errorMessage);
      }
    }

    /**
     * Handle text query on all frames - runs as a pipeline job
     */
    async function handleTextQueryAllFrames(params: {
      text: string;
      boxThreshold: number;
    }) {
      const { text, boxThreshold } = params;

      try {
        await runTextQueryPipeline(props.id, text, boxThreshold);
        await prompt({
          title: 'Text Query Pipeline Started',
          text: [
            `A pipeline job has been started to search for "${text}" in all frames.`,
            'You will be notified when the job completes.',
          ],
        });
      } catch (error) {
        await prompt({
          title: 'Text Query Pipeline Error',
          text: [`Failed to start text query pipeline: ${error}`],
        });
      }
    }

    /**
     * Interactive Stereo Service
     */
    const stereoLoadingDialog = ref(false);
    const stereoLoadingMessage = ref('Loading stereo model...');
    const stereoLoadingError = ref('');
    const stereoEnabled = ref(false);

    // Cache image path getters per camera for stereo frame setting
    const stereoImagePathGetters = ref({} as Record<string, (frameNum: number) => string>);

    function closeStereoLoadingDialog() {
      stereoLoadingDialog.value = false;
      stereoLoadingError.value = '';
    }

    /**
     * Load multicam metadata for both cameras to build image path getters
     */
    async function loadStereoMetadata() {
      try {
        const meta = await loadMetadata(props.id);
        if (!meta.multiCamMedia) return;

        const { cameras } = meta.multiCamMedia;
        const cameraNames = Object.keys(cameras);

        for (let i = 0; i < cameraNames.length; i += 1) {
          const cam = cameraNames[i];
          const cameraId = `${props.id}/${cam}`;
          // eslint-disable-next-line no-await-in-loop
          const camMeta = await loadMetadata(cameraId);
          const {
            originalBasePath, originalImageFiles, type, originalVideoFile,
          } = camMeta;

          stereoImagePathGetters.value[cam] = (frameNum: number): string => {
            if (type === 'video') {
              return npath.join(originalBasePath, originalVideoFile || '');
            }
            if (originalImageFiles && originalImageFiles[frameNum]) {
              const imagePath = originalImageFiles[frameNum];
              if (npath.isAbsolute(imagePath)) {
                return imagePath;
              }
              return npath.join(originalBasePath, imagePath);
            }
            return '';
          };
        }
      } catch (err) {
        console.error('[Stereo] Failed to load multicam metadata:', err);
      }
    }

    // Watch stereo toggle
    watch(() => clientSettings.stereoSettings.interactiveModeEnabled, async (enabled) => {
      if (enabled) {
        stereoLoadingDialog.value = true;
        stereoLoadingMessage.value = 'Loading stereo model...';
        stereoLoadingError.value = '';

        try {
          await loadStereoMetadata();
          const result = await stereoEnable();
          if (!result.success) {
            throw new Error(result.error || 'Failed to enable stereo service');
          }
          stereoEnabled.value = true;
          stereoLoadingDialog.value = false;
        } catch (err) {
          stereoEnabled.value = false;
          clientSettings.stereoSettings.interactiveModeEnabled = false;
          stereoLoadingError.value = err instanceof Error ? err.message : String(err);
        }
      } else {
        try {
          await stereoDisable();
        } catch {
          // Ignore errors on disable
        }
        stereoEnabled.value = false;
      }
    });

    // Watch frame changes to proactively compute disparity
    let lastStereoFrame = -1;
    watch(() => viewerRef.value?.aggregateController?.frame?.value, (frameNum) => {
      if (frameNum === undefined || frameNum === lastStereoFrame || !stereoEnabled.value) return;
      lastStereoFrame = frameNum;

      const cameras = Object.keys(stereoImagePathGetters.value);
      if (cameras.length < 2) return;

      const leftPath = stereoImagePathGetters.value[cameras[0]]?.(frameNum) || '';
      const rightPath = stereoImagePathGetters.value[cameras[1]]?.(frameNum) || '';

      if (leftPath && rightPath) {
        stereoSetFrame({ leftImagePath: leftPath, rightImagePath: rightPath }).catch((err) => {
          console.warn('[Stereo] Failed to set frame:', err);
        });
      }
    });

    // Clean up disparity event listeners
    let cleanupDisparityReady: (() => void) | null = null;
    let cleanupDisparityError: (() => void) | null = null;

    onMounted(() => {
      cleanupDisparityReady = onStereoDisparityReady(() => {
        // Disparity is ready for current frame - no action needed, transfers will succeed
      });
      cleanupDisparityError = onStereoDisparityError((data) => {
        console.warn('[Stereo] Disparity error:', data);
      });
    });

    onBeforeUnmount(() => {
      if (cleanupDisparityReady) cleanupDisparityReady();
      if (cleanupDisparityError) cleanupDisparityError();
    });

    /**
     * Handle stereo annotation complete event from Viewer
     * Warps annotation from source camera to the other camera
     */
    async function handleStereoAnnotationComplete(params: StereoAnnotationCompleteParams) {
      if (!stereoEnabled.value) return;

      const viewer = viewerRef.value;
      if (!viewer) return;

      const { cameraStore, multiCamList } = viewer;
      if (multiCamList.length < 2) return;

      // Determine the other camera
      const otherCamera = multiCamList.find((c: string) => c !== params.camera);
      if (!otherCamera) return;

      try {
        if (params.type === 'line') {
          const response = await stereoTransferLine({ line: params.line });
          if (!response.success || !response.transferredLine) {
            console.warn('[Stereo] Line transfer failed:', response.error);
            return;
          }

          // Get the track on the other camera and set the warped line
          const track = cameraStore.getPossibleTrack(params.trackId, otherCamera);
          if (track) {
            const lineGeometry: GeoJSON.Feature[] = [{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: response.transferredLine,
              },
              properties: { key: '' },
            }];

            // Compute bounds from the transferred line
            const xs = response.transferredLine.map((p: [number, number]) => p[0]);
            const ys = response.transferredLine.map((p: [number, number]) => p[1]);
            const bounds = [
              Math.min(...xs), Math.min(...ys),
              Math.max(...xs), Math.max(...ys),
            ] as [number, number, number, number];

            track.setFeature({
              frame: params.frameNum,
              flick: 0,
              bounds,
              keyframe: true,
              interpolate: false,
            }, lineGeometry);
          }
        } else if (params.type === 'box') {
          // Convert box bounds to 4 corner points
          const [x1, y1, x2, y2] = params.bounds;
          const corners: [number, number][] = [
            [x1, y1], [x2, y1], [x2, y2], [x1, y2],
          ];

          const response = await stereoTransferPoints({ points: corners });
          if (!response.success || !response.transferredPoints) {
            console.warn('[Stereo] Box transfer failed:', response.error);
            return;
          }

          // Compute new bounds from warped corners
          const txs = response.transferredPoints.map((p) => p[0]);
          const tys = response.transferredPoints.map((p) => p[1]);
          const newBounds = [
            Math.min(...txs), Math.min(...tys),
            Math.max(...txs), Math.max(...tys),
          ] as [number, number, number, number];

          const track = cameraStore.getPossibleTrack(params.trackId, otherCamera);
          if (track) {
            track.setFeature({
              frame: params.frameNum,
              flick: 0,
              bounds: newBounds,
              keyframe: true,
              interpolate: false,
            });
          }
        } else if (params.type === 'polygon') {
          const response = await stereoTransferPoints({ points: params.polygon });
          if (!response.success || !response.transferredPoints) {
            console.warn('[Stereo] Polygon transfer failed:', response.error);
            return;
          }

          // Close the warped polygon
          const warpedPolygon = [...response.transferredPoints];
          if (warpedPolygon.length > 0) {
            const first = warpedPolygon[0];
            const last = warpedPolygon[warpedPolygon.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              warpedPolygon.push([...first] as [number, number]);
            }
          }

          const polyGeometry: GeoJSON.Feature[] = [{
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [warpedPolygon],
            },
            properties: { key: params.key },
          }];

          // Compute bounds from warped polygon
          const pxs = response.transferredPoints.map((p) => p[0]);
          const pys = response.transferredPoints.map((p) => p[1]);
          const polyBounds = [
            Math.min(...pxs), Math.min(...pys),
            Math.max(...pxs), Math.max(...pys),
          ] as [number, number, number, number];

          const track = cameraStore.getPossibleTrack(params.trackId, otherCamera);
          if (track) {
            track.setFeature({
              frame: params.frameNum,
              flick: 0,
              bounds: polyBounds,
              keyframe: true,
              interpolate: false,
            }, polyGeometry);
          }
        } else if (params.type === 'segmentation') {
          // Transfer control points to the other camera
          const response = await stereoTransferPoints({ points: params.points });
          if (!response.success || !response.transferredPoints) {
            console.warn('[Stereo] Segmentation point transfer failed:', response.error);
            return;
          }

          // Get the image path for the other camera at this frame
          const otherImagePath = stereoImagePathGetters.value[otherCamera]?.(params.frameNum);
          if (!otherImagePath) {
            console.warn('[Stereo] No image path for other camera');
            return;
          }

          // Run segmentation prediction with warped control points on the other camera's image
          try {
            const segResponse = await segmentationPredict({
              imagePath: otherImagePath,
              points: response.transferredPoints,
              pointLabels: params.labels,
            });

            if (segResponse.polygon && segResponse.polygon.length >= 3) {
              // Close polygon if needed
              const closedPolygon = [...segResponse.polygon];
              const first = closedPolygon[0];
              const last = closedPolygon[closedPolygon.length - 1];
              if (first[0] !== last[0] || first[1] !== last[1]) {
                closedPolygon.push([...first] as [number, number]);
              }

              const segGeometry: GeoJSON.Feature[] = [{
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [closedPolygon],
                },
                properties: { key: '' },
              }];

              const segBounds = segResponse.bounds || [
                Math.min(...segResponse.polygon.map((p: [number, number]) => p[0])),
                Math.min(...segResponse.polygon.map((p: [number, number]) => p[1])),
                Math.max(...segResponse.polygon.map((p: [number, number]) => p[0])),
                Math.max(...segResponse.polygon.map((p: [number, number]) => p[1])),
              ] as [number, number, number, number];

              const track = cameraStore.getPossibleTrack(params.trackId, otherCamera);
              if (track) {
                track.setFeature({
                  frame: params.frameNum,
                  flick: 0,
                  bounds: segBounds,
                  keyframe: true,
                  interpolate: false,
                }, segGeometry);
              }
            }
          } catch (segErr) {
            console.warn('[Stereo] Segmentation prediction on other camera failed:', segErr);
          }
        }
      } catch (err) {
        console.warn('[Stereo] Annotation warping failed:', err);
      }
    }

    return {
      datasets,
      viewerRef,
      buttonOptions,
      menuOptions,
      subTypeList,
      camNumbers,
      readonlyMode,
      modifiedId,
      changeCamera,
      readOnlyMode,
      runningPipelines,
      largeImageWarning,
      handleTextQuerySubmit,
      handleTextQueryInit,
      handleTextQueryAllFrames,
      /* Stereo */
      stereoLoadingDialog,
      stereoLoadingMessage,
      stereoLoadingError,
      closeStereoLoadingDialog,
      handleStereoAnnotationComplete,
    };
  },
});
</script>

<template>
  <div class="viewer-loader-wrapper">
    <Viewer
      :id.sync="id"
      ref="viewerRef"
      :read-only-mode="readOnlyMode || runningPipelines.length > 0"
      @change-camera="changeCamera"
      @large-image-warning="largeImageWarning()"
      @text-query-submit="handleTextQuerySubmit"
      @text-query-init="handleTextQueryInit"
      @text-query-all-frames="handleTextQueryAllFrames"
      @stereo-annotation-complete="handleStereoAnnotationComplete"
    >
      <template #title>
        <v-tabs
          icons-and-text
          hide-slider
          style="flex-basis:0; flex-grow:0;"
        >
          <v-tab :to="{ name: 'recent' }">
            Library
            <v-icon>mdi-folder-open</v-icon>
          </v-tab>
          <job-tab />
          <v-tab :to="{ name: 'training' }">
            Training<v-icon>mdi-brain</v-icon>
          </v-tab>
          <v-tab :to="{ name: 'settings' }">
            Settings<v-icon>mdi-cog</v-icon>
          </v-tab>
        </v-tabs>
      </template>
      <template #title-right>
        <RunPipelineMenu
          :selected-dataset-ids="[modifiedId]"
          :sub-type-list="subTypeList"
          :camera-numbers="camNumbers"
          :running-pipelines="runningPipelines"
          :read-only-mode="readOnlyMode"
          v-bind="{ buttonOptions, menuOptions }"
        />
        <ImportAnnotations
          :dataset-id="modifiedId"
          v-bind="{ buttonOptions, menuOptions, readOnlyMode }"
          block-on-unsaved
        />
        <Export
          v-if="datasets[id]"
          :id="modifiedId"
          :button-options="buttonOptions"
        />
      </template>
      <template #right-sidebar="{ sidebarMode }">
        <SidebarContext :bottom-mode="sidebarMode === 'bottom'">
          <template #default="{ name, subCategory }">
            <component
              :is="name"
              :sub-category="subCategory"
            />
          </template>
        </SidebarContext>
      </template>
    </Viewer>
    <v-dialog
      :value="stereoLoadingDialog"
      persistent
      max-width="400"
    >
      <v-card>
        <v-card-title>Stereo Service</v-card-title>
        <v-card-text>
          <div
            v-if="!stereoLoadingError"
            class="d-flex align-center"
          >
            <v-progress-circular
              indeterminate
              color="primary"
              class="mr-3"
            />
            {{ stereoLoadingMessage }}
          </div>
          <v-alert
            v-else
            type="error"
            dense
          >
            {{ stereoLoadingError }}
          </v-alert>
        </v-card-text>
        <v-card-actions v-if="stereoLoadingError">
          <v-spacer />
          <v-btn
            text
            @click="closeStereoLoadingDialog"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.viewer-loader-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
</style>
