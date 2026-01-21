<script lang="ts">
import npath from 'path';
import {
  computed, defineComponent, ref, watch, onMounted, nextTick,
} from 'vue';
import Viewer from 'dive-common/components/Viewer.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common//components/ImportAnnotations.vue';
import SidebarContext from 'dive-common/components/SidebarContext.vue';
import context from 'dive-common/store/context';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { SegmentationPredictRequest } from 'dive-common/apispec';
import {
  segmentationPredict, segmentationInitialize, segmentationIsReady, loadMetadata, textQuery,
  runTextQueryPipeline,
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
        const errorMessage = error instanceof Error
          ? error.message
          : 'Text query model is not available. Please ensure the segmentation service is properly configured.';
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
    };
  },
});
</script>

<template>
  <Viewer
    :id.sync="id"
    ref="viewerRef"
    :read-only-mode="readOnlyMode || runningPipelines.length > 0"
    @change-camera="changeCamera"
    @large-image-warning="largeImageWarning()"
    @text-query-submit="handleTextQuerySubmit"
    @text-query-init="handleTextQueryInit"
    @text-query-all-frames="handleTextQueryAllFrames"
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
    <template #right-sidebar>
      <SidebarContext>
        <template #default="{ name, subCategory }">
          <component
            :is="name"
            :sub-category="subCategory"
          />
        </template>
      </SidebarContext>
    </template>
  </Viewer>
</template>
