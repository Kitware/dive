<script lang="ts">
import {
  computed, defineComponent, ref, watch, Ref, onMounted, onBeforeUnmount, nextTick,
} from 'vue';
import Viewer from 'dive-common/components/Viewer.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common//components/ImportAnnotations.vue';
import CalibrationMenu from 'dive-common/components/CalibrationMenu.vue';
import SidebarContext from 'dive-common/components/SidebarContext.vue';
import context from 'dive-common/store/context';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { SegmentationPredictRequest } from 'dive-common/apispec';
import { clientSettings } from 'dive-common/store/settings';
import { isStereoscopicDatasetMeta } from 'dive-common/multicamDisplay';
import type {
  StereoAnnotationCompleteParams,
  StereoAnnotationResetParams,
  StereoSegmentationFinalizeParams,
} from 'dive-common/use/useModeManager';
import { HeadPointKey, TailPointKey, HeadTailLineKey } from 'dive-common/recipes/headtail';
import {
  createStereoLengthRendering,
  STEREO_LENGTH_ATTRIBUTE_NAME,
} from 'dive-common/utils/stereoLengthRendering';
import type { RectBounds } from 'vue-media-annotator/utils';
import {
  segmentationPredict, segmentationStereoSegment, segmentationInitialize, segmentationIsReady,
  segmentationEnsureStarted,
  segmentationSam3Installed,
  loadMetadata, textQuery,
  runTextQueryPipeline,
  stereoEnable, stereoDisable, stereoSetFrame, stereoTransferLine, stereoTransferPoints,
  stereoMeasureLine, stereoAggregateLengths,
  onStereoDisparityReady, onStereoDisparityError,
  openLink,
} from 'platform/desktop/frontend/api';
import Export from './Export.vue';
import JobTab from './JobTab.vue';
import DatasetSourceInfo from './DatasetSourceInfo.vue';
import { datasets } from '../store/dataset';
import { settings } from '../store/settings';
import { runningJobs } from '../store/jobs';
import { setCloseGuard } from '../store/closeGuard';

// Renderer-safe path helpers. Node's 'path' module is externalized in the
// renderer (contextIsolation), so npath.* is unavailable here.
function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(p);
}
function joinPath(base: string, file: string): string {
  if (!base) return file;
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${file}`;
}

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
    DatasetSourceInfo,
    RunPipelineMenu,
    SidebarContext,
    Viewer,
    ImportAnnotations,
    CalibrationMenu,
    ...context.getComponents(),
  },

  // TODO: This will require an import from vue-router for Vue3 compatibility
  async beforeRouteLeave(to, from, next) {
    if (await this.viewerRef.navigateAwayGuard()) {
      next();
    }
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
    const isStereoscopicDataset = computed(() => subTypeList.value[0] === 'stereo');
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
    const timeFilter: Ref<[number, number] | null> = ref(null);
    const textQueryAvailable = ref(false);

    async function refreshTextQueryAvailability() {
      try {
        const result = await segmentationSam3Installed();
        textQueryAvailable.value = result.installed;
      } catch {
        textQueryAvailable.value = false;
      }
    }

    watch(() => settings.value?.viamePath, () => {
      refreshTextQueryAvailability();
    });

    watch(
      () => viewerRef.value?.trackFilters?.timeFilters?.value,
      (value) => {
        timeFilter.value = value ?? null;
      },
      { immediate: true },
    );

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
     * Build a function that resolves frame numbers to image file paths from dataset metadata.
     */
    function buildImagePathGetter(meta: {
      originalBasePath: string;
      originalImageFiles: string[];
      type: string;
      originalVideoFile?: string;
    }): (frameNum: number) => string {
      const {
        originalBasePath, originalImageFiles, type, originalVideoFile,
      } = meta;
      return (frameNum: number): string => {
        if (type === 'video') {
          return joinPath(originalBasePath, originalVideoFile || '');
        }
        if (originalImageFiles && originalImageFiles[frameNum]) {
          const imagePath = originalImageFiles[frameNum];
          if (isAbsolutePath(imagePath)) {
            return imagePath;
          }
          return joinPath(originalBasePath, imagePath);
        }
        return '';
      };
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

        let getImagePath: (frameNum: number) => string;
        let getFrameTime: ((frameNum: number) => number | undefined) | undefined;

        if (meta.multiCamMedia) {
          // Multicam: load per-camera metadata and build per-camera getters
          const { cameras } = meta.multiCamMedia;
          const cameraNames = Object.keys(cameras);
          let multiCamIsVideo = false;
          for (let i = 0; i < cameraNames.length; i += 1) {
            const cam = cameraNames[i];
            // eslint-disable-next-line no-await-in-loop
            const camMeta = await loadMetadata(`${props.id}/${cam}`);
            stereoImagePathGetters.value[cam] = buildImagePathGetter(camMeta);
            if (camMeta.fps) stereoCameraFps.value[cam] = camMeta.fps;
            if (camMeta.type === 'video') multiCamIsVideo = true;
          }
          stereoDatasetFps = meta.fps || meta.originalFps || stereoDatasetFps;
          // Dynamic getter that reads selectedCamera at call time
          getImagePath = (frameNum: number): string => {
            const cam = viewerRef.value?.selectedCamera;
            if (cam && stereoImagePathGetters.value[cam]) {
              return stereoImagePathGetters.value[cam](frameNum);
            }
            return '';
          };
          // Video frame-time getter keyed on the selected camera's fps. Both
          // stereo cameras share one fps; fall back to dataset / any-camera fps.
          getFrameTime = multiCamIsVideo
            ? (frameNum: number): number | undefined => {
              const cam = viewerRef.value?.selectedCamera;
              const fps = (cam ? stereoCameraFps.value[cam] : undefined)
                || stereoDatasetFps || Object.values(stereoCameraFps.value)[0];
              return fps ? frameNum / fps : undefined;
            }
            : undefined;
        } else {
          // Single cam: use base metadata directly
          const singleGetter = buildImagePathGetter(meta);
          getImagePath = singleGetter;
          // Also cache for text query and video frame usage
          cachedMeta = {
            originalBasePath: meta.originalBasePath,
            originalImageFiles: meta.originalImageFiles,
            type: meta.type,
            originalVideoFile: meta.originalVideoFile,
            fps: meta.fps,
            originalFps: meta.originalFps,
          };
          getFrameTime = cachedMeta.type === 'video' && cachedMeta.fps
            ? (frameNum: number) => frameNum / (cachedMeta!.fps || 1)
            : undefined;
        }

        // Share the resolvers with text query (handles video + multicam).
        segmentationGetImagePath = getImagePath;
        segmentationGetFrameTime = getFrameTime;

        // Initialize the recipe
        // Desktop uses imagePath from the request, so we ignore the frameNum parameter
        viewerRef.value.segmentationRecipe.initialize({
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          predictFn: (request: SegmentationPredictRequest, _frameNum: number) => segmentationPredict(request),
          getImagePath,
          getFrameTime,
          // Initialize the segmentation service when the recipe is activated (user clicks Segment button)
          // Check if already ready to avoid showing loading indicator unnecessarily
          initializeServiceFn: async () => {
            const status = await segmentationIsReady();
            if (status.ready) {
              return;
            }
            const result = await segmentationInitialize();
            if (result.noSamInstalled) {
              await prompt({
                title: 'SAM Not Installed',
                text: [
                  'Neither the SAM2 nor SAM3 model pack appears to be installed.',
                  'Interactive segmentation will use the default GrabCut fallback, which may be less accurate.',
                  'See the VIAME Add-On wiki to download a SAM model pack.',
                ],
              });
            }
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

    // Frame -> media-path / frame-time resolvers built by initializeSegmentation.
    // Shared with text query so it resolves video and multicam media the same way
    // segmentation does (selected-camera aware, video frame-time aware).
    let segmentationGetImagePath: ((frameNum: number) => string) | null = null;
    let segmentationGetFrameTime: ((frameNum: number) => number | undefined) | undefined;

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
    // Loading state for the single-frame (interactive) text query. The
    // all-frames path runs as a pipeline job with its own progress UI, so it
    // does not use this.
    const textQueryRunning = ref(false);

    async function handleTextQuerySubmit(params: {
      text: string;
      boxThreshold: number;
      frameNum: number;
      replaceExisting?: boolean;
    }) {
      const {
        text, boxThreshold, frameNum, replaceExisting = false,
      } = params;

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

      // Prefer the segmentation resolvers (selected-camera + video aware); fall
      // back to the single-cam image-sequence getter if segmentation never
      // initialized.
      const imagePath = segmentationGetImagePath?.(frameNum) || getImagePathForFrame(frameNum);
      const frameTime = segmentationGetFrameTime?.(frameNum);
      if (!imagePath) {
        await prompt({
          title: 'Text Query Error',
          text: ['Could not determine image path for current frame.'],
        });
        return;
      }

      textQueryRunning.value = true;
      try {
        const response = await textQuery({
          imagePath,
          frameTime,
          text,
          boxThreshold,
          maxDetections: 10,
        });
        // Query finished; drop the loading bar before any result/error prompts.
        textQueryRunning.value = false;

        if (!response.success) {
          throw new Error(response.error || 'Text query failed');
        }

        const detections = response.detections || [];

        // Resolve the target camera/track store up front so that "replace"
        // can clear the current frame even when the query returns nothing.
        const cameraStore = viewerRef.value?.cameraStore;
        const selectedCamera = viewerRef.value?.selectedCamera || 'singleCam';
        const trackStore = cameraStore?.camMap.value.get(selectedCamera)?.trackStore;

        // When replacing, remove annotations already present on this frame
        // before adding the query results. Tracks that exist only on this
        // frame are removed entirely; tracks spanning other frames lose just
        // this frame's feature (and are removed if that empties them). Other
        // frames' annotations are left untouched.
        if (replaceExisting && cameraStore && trackStore) {
          const removeIds: number[] = [];
          trackStore.annotationMap.forEach((track) => {
            if (frameNum < track.begin || frameNum > track.end) {
              return;
            }
            if (track.begin === frameNum && track.end === frameNum) {
              removeIds.push(track.id);
            } else {
              track.deleteFeature(frameNum);
              if (track.featureIndex.length === 0) {
                removeIds.push(track.id);
              }
            }
          });
          removeIds.forEach((id) => cameraStore.remove(id, selectedCamera));
        }

        if (detections.length === 0) {
          await prompt({
            title: 'Text Query Results',
            text: [`No objects matching "${text}" were found in the current frame.`],
          });
          return;
        }

        // Create tracks from detections
        if (cameraStore && trackStore) {
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

            // add() seeds the confidence pair at 1.0; apply the detection's
            // actual confidence from the text-query model so it isn't shown
            // as 100%. (setType clamps >=1 to 1.0, which is the correct
            // behavior for a genuinely-1.0 score.)
            if (typeof det.score === 'number') {
              newTrack.setType(det.label, det.score);
            }

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
        textQueryRunning.value = false;
        await prompt({
          title: 'Text Query Error',
          text: [`Failed to execute text query: ${error}`],
        });
      } finally {
        textQueryRunning.value = false;
        // Exit edit/draw mode after text query completes (success or failure)
        if (viewerRef.value?.handler) {
          viewerRef.value.handler.trackAbort();
        }
      }
    }

    // Initialize segmentation when component is mounted
    onMounted(() => {
      initializeSegmentation();
      refreshTextQueryAvailability();
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

        // Start the service process only -- do NOT warm the point-segmentation
        // model. The text-query model loads lazily on the first query.
        await segmentationEnsureStarted();
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
      replaceExisting?: boolean;
    }) {
      const { text, boxThreshold, replaceExisting = false } = params;

      try {
        await runTextQueryPipeline(props.id, text, boxThreshold, replaceExisting);
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
    // Title shown while the loading dialog is in its error state. Lets the same
    // dialog surface both service-startup and per-transfer failures instead of
    // spawning a second popup.
    const stereoErrorTitle = ref('Stereo Service Error');
    // Alert severity for that error state. A per-transfer failure (no stereo
    // match found) is a common, recoverable event -- shown as a softer
    // 'warning' -- whereas a service-startup failure is a hard 'error' (red).
    const stereoErrorSeverity = ref<'error' | 'warning'>('error');
    const stereoEnabled = ref(false);
    // Transient notification reporting the latest computed stereo length
    const stereoLengthSnackbar = ref(false);
    const stereoLengthMessage = ref('');

    // Cache image path getters per camera for stereo frame setting
    const stereoImagePathGetters = ref({} as Record<string, (frameNum: number) => string>);
    // Per-camera FPS, used to convert a frame number to a frame time for video stereo.
    const stereoCameraFps = ref({} as Record<string, number>);

    function closeStereoLoadingDialog() {
      stereoLoadingDialog.value = false;
      stereoLoadingError.value = '';
    }

    // Calibration file path for stereo matching
    let stereoCalibrationFile: string | undefined;
    // Dataset-level FPS fallback for video frame-time computation, used when a
    // per-camera metadata entry has no fps (both stereo cameras share one fps).
    let stereoDatasetFps: number | undefined;

    /**
     * Load multicam metadata for both cameras to build image path getters
     */
    async function loadStereoMetadata(): Promise<boolean> {
      try {
        const meta = await loadMetadata(props.id);
        // Plain multicam and single-camera datasets have no stereo pair: report
        // no stereo so the caller does not load the stereo service.
        if (!meta.multiCamMedia || !isStereoscopicDatasetMeta(meta)) return false;

        // Extract calibration file path from multiCam metadata
        stereoCalibrationFile = meta.multiCam?.calibration || undefined;
        // Capture the dataset-level fps as a fallback for per-camera frame times.
        stereoDatasetFps = meta.fps || meta.originalFps || stereoDatasetFps;

        // Skip per-camera metadata loading if already populated (e.g. by initializeSegmentation)
        if (Object.keys(stereoImagePathGetters.value).length > 0) return true;

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
              return joinPath(originalBasePath, originalVideoFile || '');
            }
            if (originalImageFiles && originalImageFiles[frameNum]) {
              const imagePath = originalImageFiles[frameNum];
              if (isAbsolutePath(imagePath)) {
                return imagePath;
              }
              return joinPath(originalBasePath, imagePath);
            }
            return '';
          };
        }
        return true;
      } catch (err) {
        console.error('[Stereo] Failed to load multicam metadata:', err);
        return false;
      }
    }

    // Track last stereo frame to avoid redundant set_frame calls
    let lastStereoFrame = -1;

    function getViewerFrame(): number | undefined {
      const viewer = viewerRef.value;
      if (!viewer?.progress?.loaded) return undefined;
      try {
        return viewer.aggregateController?.frame?.value;
      } catch {
        return undefined;
      }
    }

    // Push the stereo frame (left/right paths + frame time) to the backend and
    // wait for it to land. Returns whether disparity/images are ready, so callers
    // that need a correspondence (line/point transfer) can guarantee readiness
    // instead of racing the proactive watcher. Updates lastStereoFrame on success.
    async function ensureStereoFrame(frameNum: number | undefined): Promise<boolean> {
      if (frameNum === undefined || !stereoEnabled.value) return false;
      const cameras = Object.keys(stereoImagePathGetters.value);
      if (cameras.length < 2) return false;
      const leftPath = stereoImagePathGetters.value[cameras[0]]?.(frameNum) || '';
      const rightPath = stereoImagePathGetters.value[cameras[1]]?.(frameNum) || '';
      if (!leftPath || !rightPath) return false;
      const fps0 = stereoCameraFps.value[cameras[0]]
        || stereoDatasetFps || Object.values(stereoCameraFps.value)[0];
      const ft = fps0 ? frameNum / fps0 : undefined;
      try {
        const r = await stereoSetFrame({
          leftImagePath: leftPath, rightImagePath: rightPath, frameTime: ft,
        });
        if (r.success) lastStereoFrame = frameNum;
        return r.success;
      } catch (err) {
        console.warn('[Stereo] Failed to set frame:', err);
        return false;
      }
    }

    // The backend stereo service is needed whenever either stereo feature is on
    // (length-on-modify or cross-camera auto-compute). Track the combined state
    // so toggling one feature while the other is already on does not restart it.
    const stereoServiceWanted = () => isStereoscopicDataset.value && (
      clientSettings.stereoSettings.updateLengthsOnModify
      || clientSettings.stereoSettings.autoComputeOtherCamera
    );

    function disableStereoFeatureToggles() {
      clientSettings.stereoSettings.updateLengthsOnModify = false;
      clientSettings.stereoSettings.autoComputeOtherCamera = false;
    }

    // Enable or disable the backend stereo service to match the desired state.
    // Failures are always surfaced in the (persistent) dialog; userInitiated
    // additionally reverts the feature toggles, since the user just asked for
    // something that cannot work, whereas a load-time auto-enable failure
    // (e.g. an uncalibrated dataset) keeps the remembered toggles so a later
    // calibrated dataset still works.
    async function applyStereoServiceState(enabled: boolean, userInitiated: boolean) {
      if (enabled) {
        // Already running (e.g. a user toggle raced the load-time auto-enable):
        // nothing to do.
        if (stereoEnabled.value) return;
        stereoLoadingError.value = '';

        try {
          const hasStereo = await loadStereoMetadata();
          if (!hasStereo) {
            // Single-camera dataset: nothing to enable. Do NOT spin up the
            // stereo service. Leave the toggles untouched so the defaults still
            // apply when a stereo dataset is opened later. Remember the
            // determination so the per-annotation self-heal doesn't re-check.
            stereoDatasetUnavailable = true;
            stereoEnabled.value = false;
            stereoLoadingDialog.value = false;
            return;
          }
          // Show the (persistent, annotation-blocking) loading dialog while
          // the service starts -- including the load-time auto-enable, so
          // entering a sequence with a stereo feature on visibly blocks
          // annotation until measurements will actually work.
          stereoLoadingMessage.value = 'Loading stereo model...';
          stereoLoadingDialog.value = true;
          const result = await stereoEnable(undefined, stereoCalibrationFile);
          if (!result.success) {
            // launchFailed means the backend service couldn't even start (e.g.
            // missing python interpreter or a broken import). That is a real
            // error and must always be surfaced, even on the load-time
            // auto-enable, instead of degrading silently like a missing
            // calibration would.
            const err = new Error(result.error || 'Failed to enable stereo service');
            (err as Error & { launchFailed?: boolean }).launchFailed = result.launchFailed;
            throw err;
          }
          stereoEnabled.value = true;
          stereoLoadingDialog.value = false;

          // Kick off disparity computation for the current frame. A failure here
          // must NOT tear down the already-enabled service -- the line/point draw
          // handler re-sets the frame before transferring, so it self-recovers.
          await ensureStereoFrame(getViewerFrame());
        } catch (err) {
          stereoEnabled.value = false;
          console.error('[Stereo] Failed to enable interactive stereo:', err);
          const launchFailed = (err as Error & { launchFailed?: boolean }).launchFailed === true;
          if (userInitiated || launchFailed) {
            // The user explicitly enabled a feature, or the backend service
            // failed to launch (an infrastructure error): revert the toggles.
            disableStereoFeatureToggles();
          }
          // Always surface the failure -- a stereo feature is on, so lengths
          // and transfers will NOT work; silently degrading here made that
          // look like annotations simply weren't measuring. Load-time
          // failures (e.g. an uncalibrated dataset) keep the toggles so a
          // later calibrated dataset still works.
          stereoErrorTitle.value = 'Stereo Service Error';
          stereoErrorSeverity.value = 'error';
          stereoLoadingError.value = err instanceof Error ? err.message : String(err);
          stereoLoadingDialog.value = true;
        }
      } else {
        try {
          await stereoDisable();
        } catch {
          // Ignore errors on disable
        }
        stereoEnabled.value = false;
      }
    }

    // In-flight enable/disable promise. Stereo work requested while the
    // service is still starting (spawning the backend service on a fresh
    // launch can take a while) waits for it via stereoServiceReady instead of
    // being dropped -- e.g. a line drawn on both cameras right after launch
    // must still get its length computed once the service comes up.
    let stereoStatePromise: Promise<void> | null = null;
    // True once this dataset was determined to have no stereo pair, so the
    // per-annotation self-heal below doesn't re-load metadata on every draw
    // in single-camera datasets.
    let stereoDatasetUnavailable = false;

    function resetStereoStateForDatasetChange() {
      stereoDatasetUnavailable = false;
      stereoImagePathGetters.value = {};
      stereoCameraFps.value = {};
      lastStereoFrame = -1;
      stereoCalibrationFile = undefined;
      stereoDatasetFps = undefined;
      closeStereoLoadingDialog();
    }

    function requestStereoServiceState(enabled: boolean, userInitiated: boolean): Promise<void> {
      const p = applyStereoServiceState(enabled, userInitiated).finally(() => {
        if (stereoStatePromise === p) stereoStatePromise = null;
      });
      stereoStatePromise = p;
      return p;
    }

    watch(() => props.id, () => {
      resetStereoStateForDatasetChange();
      if (stereoEnabled.value) {
        requestStereoServiceState(false, false);
      }
    });

    watch(isStereoscopicDataset, (isStereo) => {
      if (!isStereo) {
        stereoDatasetUnavailable = true;
        if (stereoEnabled.value) {
          requestStereoServiceState(false, false);
        }
      } else {
        stereoDatasetUnavailable = false;
      }
    });

    // Wait out any in-flight enable/disable; returns whether the service is up.
    async function stereoServiceReady(): Promise<boolean> {
      // Self-heal: a stereo feature is wanted but no enable is running and
      // none succeeded (e.g. the load-time auto-enable never fired or failed
      // transiently) -- kick one off now, driven by the annotation that needs
      // it. This guarantees drawing a line always forces the stereo service
      // up rather than silently producing no measurement.
      if (!stereoEnabled.value && !stereoStatePromise
        && !stereoDatasetUnavailable && stereoServiceWanted()) {
        requestStereoServiceState(true, false);
      }
      while (stereoStatePromise) {
        // eslint-disable-next-line no-await-in-loop
        await stereoStatePromise;
      }
      return stereoEnabled.value;
    }

    // Runtime toggle changes are always user-initiated. This watcher is NOT
    // immediate: a remembered setting must NOT auto-enable here, because this
    // runs during setup() -- before the dataset/viewer has loaded. Enabling then
    // races the not-yet-ready multicam metadata; on failure the load-time path
    // degrades silently with nothing to retry, so the service would stay off
    // until the toggle was flipped off and on again. The load-time auto-enable
    // is deferred to the viewer-ready watcher below instead.
    watch(stereoServiceWanted, (enabled) => requestStereoServiceState(enabled, true));

    // Load-time auto-enable of a remembered setting: run once the viewer has
    // actually finished loading the dataset (progress.loaded), so the metadata
    // and calibration the enable needs are available. One-shot -- stop after the
    // first load so later dataset reloads (which reset progress.loaded) do not
    // re-trigger it.
    const stopStereoAutoEnable = watch(
      () => viewerRef.value?.progress?.loaded === true,
      (loaded) => {
        if (!loaded) return;
        stopStereoAutoEnable();
        if (stereoServiceWanted() && !stereoEnabled.value) {
          requestStereoServiceState(true, false);
        }
      },
      { immediate: true },
    );

    // Watch frame changes to proactively compute disparity
    watch(() => getViewerFrame(), (frameNum) => {
      if (frameNum === undefined || frameNum === lastStereoFrame || !stereoEnabled.value) return;
      lastStereoFrame = frameNum;
      ensureStereoFrame(frameNum);
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
     * Get or create a track on the target camera.
     * In multicam, a track drawn on one camera doesn't automatically exist on the other.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function getOrCreateStereoTrack(cameraStore: any, trackId: number, sourceCamera: string, targetCamera: string, frameNum: number) {
      let track = cameraStore.getPossibleTrack(trackId, targetCamera);
      if (!track) {
        const targetTrackStore = cameraStore.camMap.value.get(targetCamera)?.trackStore;
        if (targetTrackStore) {
          const sourceTrack = cameraStore.getPossibleTrack(trackId, sourceCamera);
          const trackType = sourceTrack?.confidencePairs?.[0]?.[0] || 'unknown';
          track = targetTrackStore.add(frameNum, trackType, undefined, trackId);
        }
      }
      return track;
    }

    /**
     * Extract the two endpoints of a 2-point LineString from a track's feature
     * at the given frame. Returns null if there is no such line.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function getStereoLineEndpoints(track: any, frameNum: number)
      : [[number, number], [number, number]] | null {
      if (!track) return null;
      const [feature] = track.getFeature(frameNum);
      if (!feature || !feature.geometry) return null;
      const lineFeat = feature.geometry.features.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f: any) => f.geometry.type === 'LineString' && f.geometry.coordinates.length === 2,
      );
      if (!lineFeat) return null;
      const c = lineFeat.geometry.coordinates as [number, number][];
      return [c[0], c[1]];
    }

    /**
     * Extract the outer ring of the first Polygon in a track's feature at a frame.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function getStereoPolygon(track: any, frameNum: number): [number, number][] | null {
      if (!track) return null;
      const [feature] = track.getFeature(frameNum);
      if (!feature || !feature.geometry) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const polyFeat = feature.geometry.features.find((f: any) => f.geometry.type === 'Polygon');
      if (!polyFeat) return null;
      const ring = polyFeat.geometry.coordinates[0];
      return ring && ring.length >= 3 ? (ring as [number, number][]) : null;
    }

    /**
     * Add a head/tail line (LineString + head/tail points) to a track's existing
     * feature at a frame. Preserves any existing geometry (e.g. a segmentation
     * polygon) and replaces any prior line/head/tail so re-running is idempotent.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyStereoLine(track: any, frameNum: number, line: [[number, number], [number, number]]) {
      if (!track) return;
      const [feature] = track.getFeature(frameNum);
      if (!feature || !feature.keyframe || !feature.geometry) return;
      const [p1, p2] = line;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const preserved = (feature.geometry.features || []).filter((f: any) => {
        if (f.geometry.type === 'LineString') return false;
        const key = f.properties?.key;
        return key !== HeadPointKey && key !== TailPointKey;
      });
      const lineGeometry: GeoJSON.Feature[] = [
        ...preserved,
        { type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { key: HeadTailLineKey } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [p1[0], p1[1]] }, properties: { key: HeadPointKey } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [p2[0], p2[1]] }, properties: { key: TailPointKey } },
      ];
      track.setFeature({ frame: frameNum, keyframe: true }, lineGeometry);
    }

    const STEREO_MEASUREMENT_ATTRS = [
      'length', 'midpoint_x', 'midpoint_y', 'midpoint_z', 'midpoint_range', 'stereo_rms',
    ];

    // Per-feature marker: a human (not the stereo warp) authored this camera's
    // line at this frame. Once set, interactive stereo never overwrites that
    // side's geometry again — only the user can. Kept off the Attributes panel.
    const STEREO_USER_LINE_ATTR = 'stereo_user_line';
    // How the length was set: 'stereo' = auto-computed from the warped lines,
    // 'user_set' = locked by the user (auto-update leaves the length alone).
    const STEREO_LENGTH_METHOD_ATTR = 'length_method';

    interface SavedStereoCameraState {
      trackExisted: boolean;
      hadFeature: boolean;
      bounds?: RectBounds;
      interpolate?: boolean;
      geometryFeatures?: GeoJSON.Feature[];
      fishLength?: number;
      attributes?: Record<string, unknown>;
    }

    const preStereoSegmentationState = new Map<string, Record<string, SavedStereoCameraState>>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function captureStereoCameraState(track: any, frameNum: number): SavedStereoCameraState {
      if (!track) {
        return { trackExisted: false, hadFeature: false };
      }
      const [feature] = track.getFeature(frameNum);
      if (!feature || !feature.keyframe) {
        return { trackExisted: true, hadFeature: false };
      }
      return {
        trackExisted: true,
        hadFeature: true,
        bounds: feature.bounds ? [...feature.bounds] as RectBounds : undefined,
        interpolate: feature.interpolate,
        geometryFeatures: feature.geometry?.features
          ? JSON.parse(JSON.stringify(feature.geometry.features))
          : undefined,
        fishLength: feature.fishLength,
        attributes: feature.attributes
          ? JSON.parse(JSON.stringify(feature.attributes))
          : undefined,
      };
    }

    function savePreStereoSegmentationState(
      trackId: number,
      frameNum: number,
      sourceCamera: string,
      otherCamera: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cameraStore: any,
    ) {
      const key = `${trackId}:${frameNum}`;
      if (preStereoSegmentationState.has(key)) return;
      preStereoSegmentationState.set(key, {
        [sourceCamera]: captureStereoCameraState(
          cameraStore.getPossibleTrack(trackId, sourceCamera),
          frameNum,
        ),
        [otherCamera]: captureStereoCameraState(
          cameraStore.getPossibleTrack(trackId, otherCamera),
          frameNum,
        ),
      });
    }

    function restoreStereoCameraState(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cameraStore: any,
      trackId: number,
      camera: string,
      frameNum: number,
      saved: SavedStereoCameraState,
    ) {
      if (!saved.trackExisted) {
        const track = cameraStore.getPossibleTrack(trackId, camera);
        if (track) {
          cameraStore.removeTracks(trackId, camera);
        }
        return;
      }
      const track = cameraStore.getPossibleTrack(trackId, camera);
      if (!track) return;
      if (!saved.hadFeature) {
        track.deleteFeature(frameNum);
        return;
      }
      track.deleteFeature(frameNum);
      track.setFeature({
        frame: frameNum,
        flick: 0,
        bounds: saved.bounds,
        keyframe: true,
        interpolate: saved.interpolate ?? false,
        fishLength: saved.fishLength,
        attributes: saved.attributes
          ? JSON.parse(JSON.stringify(saved.attributes))
          : undefined,
      }, saved.geometryFeatures || []);
    }

    function clearPreStereoSegmentationState() {
      preStereoSegmentationState.clear();
    }

    /**
     * Ensure the standard stereo measurement attributes are defined as numeric
     * detection attributes so they're visible in the Attributes panel.
     */
    function ensureMeasurementAttributes() {
      const viewer = viewerRef.value;
      if (!viewer || !viewer.handler || !viewer.handler.setAttribute) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (viewer.attributes || []) as any[];
      STEREO_MEASUREMENT_ATTRS.forEach((name) => {
        const existingAttr = existing.find((a) => a.name === name && a.belongs === 'detection');
        if (!existingAttr) {
          viewer.handler.setAttribute({
            data: {
              belongs: 'detection',
              datatype: 'number',
              name,
              key: `detection_${name}`,
              ...(name === STEREO_LENGTH_ATTRIBUTE_NAME
                ? { render: createStereoLengthRendering(name) }
                : {}),
            },
          });
        } else if (name === STEREO_LENGTH_ATTRIBUTE_NAME && !existingAttr.render) {
          viewer.handler.setAttribute({
            data: {
              ...existingAttr,
              render: createStereoLengthRendering(existingAttr.name),
            },
          });
        }
      });
      // How the length was set: lets the user lock a length to 'user_set' so the
      // stereo auto-update stops overwriting it.
      if (!existing.find((a) => a.name === STEREO_LENGTH_METHOD_ATTR && a.belongs === 'detection')) {
        viewer.handler.setAttribute({
          data: {
            belongs: 'detection',
            datatype: 'text',
            name: STEREO_LENGTH_METHOD_ATTR,
            key: `detection_${STEREO_LENGTH_METHOD_ATTR}`,
            values: ['stereo', 'user_set'],
          },
        });
      }
      // Track-level average length (mean of the per-frame lengths along the track).
      if (!existing.find((a) => a.name === 'avg_length' && a.belongs === 'track')) {
        viewer.handler.setAttribute({
          data: {
            belongs: 'track',
            datatype: 'number',
            name: 'avg_length',
            key: 'track_avg_length',
          },
        });
      }
    }

    /**
     * Recompute the average stereo length along a whole track and store it as
     * the track-level 'avg_length' attribute. The per-frame lengths are gathered
     * from the track (needs nothing but the track); the aggregation itself is
     * done in VIAME by viame::core::aggregate_lengths (the same helper the
     * pair_stereo_tracks pipeline uses), reached via the stereo service.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function updateTrackAverageLength(track: any) {
      if (!track) return;
      const frames = track.featureIndex || [];
      const lengths: number[] = [];
      for (let i = 0; i < frames.length; i += 1) {
        const feature = track.features[frames[i]];
        const lengthAttr = feature?.attributes?.length;
        const fromAttr = lengthAttr !== undefined && lengthAttr !== null
          ? Number(lengthAttr)
          : NaN;
        const length = Number.isFinite(fromAttr) ? fromAttr : feature?.fishLength;
        if (feature && Number.isFinite(length)) {
          lengths.push(length);
        }
      }
      if (lengths.length === 0) return;

      const response = await stereoAggregateLengths({ lengths });
      if (response.success && Number.isFinite(response.avgLength)) {
        track.setAttribute('avg_length', Math.round((response.avgLength as number) * 100) / 100);
      }
    }

    /**
     * Recompute the track-level average length for both camera tracks of a
     * linked pair. Called once per measurement event (after per-frame lengths
     * have been written).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function updateStereoTrackAverages(cameraStore: any, trackId: number) {
      const cameras = Object.keys(stereoImagePathGetters.value);
      if (cameras.length < 2) return;
      const [leftCamera, rightCamera] = cameras;
      await updateTrackAverageLength(cameraStore.getPossibleTrack(trackId, leftCamera));
      await updateTrackAverageLength(cameraStore.getPossibleTrack(trackId, rightCamera));
    }

    /**
     * Store a full stereo measurement on a track feature. length is written to
     * the canonical fishLength (VIAME CSV length column) and to a 'length'
     * attribute; the remaining standard measurements (midpoint x/y/z, range,
     * RMS) are stored as detection attributes.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyStereoMeasurement(track: any, frameNum: number, measurement: any) {
      if (!track || !measurement) return;
      const round2 = (v: number) => Math.round(v * 100) / 100;
      const [feature] = track.getFeature(frameNum);
      // A length the user locked (length_method === 'user_set') is never
      // overwritten; the other measurements still track the shifting geometry.
      const lengthLocked = feature?.attributes?.[STEREO_LENGTH_METHOD_ATTR] === 'user_set';
      const { length } = measurement;
      if (!lengthLocked && length !== undefined && Number.isFinite(length)) {
        if (feature && feature.keyframe) {
          // Merge fishLength without disturbing existing geometry/bounds
          track.setFeature({ frame: frameNum, fishLength: round2(length) });
          track.setFeatureAttribute(frameNum, STEREO_LENGTH_METHOD_ATTR, 'stereo');
        }
      }
      STEREO_MEASUREMENT_ATTRS.forEach((name) => {
        if (name === 'length' && lengthLocked) return;
        const v = measurement[name];
        if (v !== undefined && Number.isFinite(v)) {
          track.setFeatureAttribute(frameNum, name, round2(v));
        }
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function reportStereoMeasurement(measurement: any) {
      if (!measurement || !Number.isFinite(measurement.length)) return;
      const round2 = (v: number) => Math.round(v * 100) / 100;
      const parts = [`Stereo length: ${round2(measurement.length)}`];
      if (Number.isFinite(measurement.midpoint_range)) {
        parts.push(`range: ${round2(measurement.midpoint_range)}`);
      }
      stereoLengthMessage.value = parts.join('  •  ');
      stereoLengthSnackbar.value = true;
    }

    /**
     * Triangulate and store the stereo measurement for one frame of a track that
     * has a 2-point line on both cameras. Returns the measurement, or null if
     * either side lacks a line (or the service fails).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function measureStereoLineAtFrame(cameraStore: any, trackId: number, frameNum: number) {
      const cameras = Object.keys(stereoImagePathGetters.value);
      if (cameras.length < 2) return null;
      const [leftCamera, rightCamera] = cameras;
      const leftTrack = cameraStore.getPossibleTrack(trackId, leftCamera);
      const rightTrack = cameraStore.getPossibleTrack(trackId, rightCamera);
      const leftLine = getStereoLineEndpoints(leftTrack, frameNum);
      const rightLine = getStereoLineEndpoints(rightTrack, frameNum);
      if (!leftLine || !rightLine) return null;

      const response = await stereoMeasureLine({ leftLine, rightLine });
      if (response.success && response.measurement) {
        ensureMeasurementAttributes();
        applyStereoMeasurement(leftTrack, frameNum, response.measurement);
        applyStereoMeasurement(rightTrack, frameNum, response.measurement);
        return response.measurement;
      }
      return null;
    }

    /**
     * Recompute the stereo measurement for a line annotation that exists on both
     * cameras (e.g. after the user edited or drew one side) and update both tracks.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function autoUpdateStereoLength(cameraStore: any, trackId: number, frameNum: number) {
      const measurement = await measureStereoLineAtFrame(cameraStore, trackId, frameNum);
      if (measurement) {
        reportStereoMeasurement(measurement);
        await updateStereoTrackAverages(cameraStore, trackId);
      }
    }

    /**
     * Handle two detections being linked across cameras (multicam link tool).
     * Recompute the stereo measurement for every frame where both the left and
     * right tracks now have a 2-point line.
     */
    async function handleStereoTrackLinked(trackId: number) {
      // Wait out a still-starting service rather than dropping the recompute.
      if (!stereoEnabled.value && !(await stereoServiceReady())) return;
      // Linking a pair across cameras only (re)computes their stereo lengths.
      if (!clientSettings.stereoSettings.updateLengthsOnModify) return;
      const viewer = viewerRef.value;
      if (!viewer) return;
      const { cameraStore, multiCamList } = viewer;
      if (multiCamList.length < 2) return;
      const cameras = Object.keys(stereoImagePathGetters.value);
      if (cameras.length < 2) return;

      const [leftCamera, rightCamera] = cameras;
      const leftTrack = cameraStore.getPossibleTrack(trackId, leftCamera);
      const rightTrack = cameraStore.getPossibleTrack(trackId, rightCamera);
      if (!leftTrack || !rightTrack) return;

      // Frames present in either track (each frame's line presence is re-checked
      // inside measureStereoLineAtFrame).
      const frames = Array.from(new Set<number>([
        ...(leftTrack.featureIndex || []),
        ...(rightTrack.featureIndex || []),
      ]));

      let lastMeasurement = null;
      for (let i = 0; i < frames.length; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const measurement = await measureStereoLineAtFrame(cameraStore, trackId, frames[i]);
          if (measurement) lastMeasurement = measurement;
        } catch (err) {
          console.warn('[Stereo] Link measurement failed:', err);
        }
      }
      if (lastMeasurement) {
        reportStereoMeasurement(lastMeasurement);
        await updateStereoTrackAverages(cameraStore, trackId);
      }
    }

    /**
     * Handle stereo annotation complete event from Viewer
     * Warps annotation from source camera to the other camera
     */
    async function handleStereoAnnotationComplete(params: StereoAnnotationCompleteParams) {
      // This handler only fires on human edits — the stereo warp writes
      // geometry directly, bypassing the annotation-complete event — so the
      // camera the user just drew/edited is now human-authored. Mark it
      // BEFORE any waiting below (no service is needed for this): the wait
      // can be long on a fresh launch, and a line drawn on the other camera
      // in the meantime must see this one as human-authored, not
      // machine-generated, so the warp can never overwrite it.
      if (params.type === 'line') {
        const sourceTrack = viewerRef.value?.cameraStore
          ?.getPossibleTrack(params.trackId, params.camera);
        sourceTrack?.setFeatureAttribute(params.frameNum, STEREO_USER_LINE_ATTR, true);
      }

      // The service may still be starting (the load-time auto-enable spawns
      // the backend service, which can take a while on a fresh launch). Wait
      // for it rather than dropping the annotation's stereo work -- the
      // other-camera state below is re-read after the wait, so lines drawn on
      // both cameras in the meantime still get their length computed.
      if (!stereoEnabled.value && !(await stereoServiceReady())) return;

      const viewer = viewerRef.value;
      if (!viewer) return;

      const { cameraStore, multiCamList } = viewer;
      if (multiCamList.length < 2) return;

      // Determine the other camera
      const otherCamera = multiCamList.find((c: string) => c !== params.camera);
      if (!otherCamera) return;

      const otherTrack = cameraStore.getPossibleTrack(params.trackId, otherCamera);
      const [otherFeature] = otherTrack ? otherTrack.getFeature(params.frameNum) : [null];
      const otherHasFeature = otherFeature !== null;

      // Two independent stereo behaviors gate this handler:
      //  - updateLengths: recompute the stereo measurement when both cameras
      //    already have the detection and a line is modified.
      //  - autoCompute: warp the annotation to the other camera when it has no
      //    detection for it yet (or its line is still machine-generated).
      const updateLengths = clientSettings.stereoSettings.updateLengthsOnModify;
      const autoCompute = clientSettings.stereoSettings.autoComputeOtherCamera;

      if (params.type === 'line') {
        const otherIsHuman = otherHasFeature
          && otherFeature?.attributes?.[STEREO_USER_LINE_ATTR] === true;
        if (otherIsHuman || !autoCompute) {
          // Keep the other side's geometry as-is — either it was authored by the
          // user (never overwrite it) or cross-camera auto-compute is disabled.
          // If both cameras now have a line, just refresh the measurement.
          if (updateLengths && otherHasFeature) {
            try {
              await autoUpdateStereoLength(cameraStore, params.trackId, params.frameNum);
            } catch (err) {
              console.warn('[Stereo] Measurement update failed:', err);
            }
          }
          return;
        }
        // Otherwise (auto-compute on, other side absent or still machine-generated)
        // fall through and (re)warp source -> other so the auto-generated line
        // keeps tracking edits.
      } else if (otherHasFeature) {
        // Box / polygon / segmentation: warp only once; leave existing untouched.
        return;
      } else if (!autoCompute) {
        // Creating geometry on the other camera is gated by auto-compute.
        return;
      }

      // Show loading indicator while waiting for stereo transfer
      stereoLoadingMessage.value = 'Computing stereo correspondence...';
      stereoLoadingError.value = '';
      stereoLoadingDialog.value = true;

      // Guarantee the backend has this frame's images before transferring. The
      // proactive watcher only fires on frame-number changes, so a draw on the
      // frame where stereo was enabled would otherwise stall in the backend's
      // deferred disparity wait.
      await ensureStereoFrame(params.frameNum);

      try {
        if (params.type === 'line') {
          const response = await stereoTransferLine({ line: params.line });
          if (!response.success || !response.transferredLine) {
            throw new Error(response.error || 'Line transfer returned no result');
          }

          // Get or create the track on the other camera and set the warped line
          const track = getOrCreateStereoTrack(cameraStore, params.trackId, params.camera, otherCamera, params.frameNum);
          if (track) {
            const [p1, p2] = response.transferredLine;
            // Preserve the source line's key and include head/tail Point markers
            // so the warped line is a standard, line-mode-editable annotation.
            const lineGeometry: GeoJSON.Feature[] = [
              {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: response.transferredLine },
                properties: { key: params.key },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p1[0], p1[1]] },
                properties: { key: HeadPointKey },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p2[0], p2[1]] },
                properties: { key: TailPointKey },
              },
            ];

            // Compute bounds from the transferred line with 10% expansion to
            // match the expansion applied on the source camera side (headtail.ts).
            const minX = Math.min(p1[0], p2[0]);
            const minY = Math.min(p1[1], p2[1]);
            const maxX = Math.max(p1[0], p2[0]);
            const maxY = Math.max(p1[1], p2[1]);
            const width = maxX - minX;
            const height = maxY - minY;
            const padX = width * 0.10 || height * 0.10;
            const padY = height * 0.10 || width * 0.10;
            let bx0 = minX - padX;
            let bx1 = maxX + padX;
            let by0 = minY - padY;
            let by1 = maxY + padY;
            // Cap the aspect ratio so a near-axis-aligned warped line doesn't make
            // a razor-thin box (matches headtail.ts MAX_BOX_ASPECT_RATIO).
            const MAX_BOX_ASPECT_RATIO = 6;
            const bw = bx1 - bx0;
            const bh = by1 - by0;
            if (bw > 0 && bh > 0) {
              if (bw / bh > MAX_BOX_ASPECT_RATIO) {
                const grow = (bw / MAX_BOX_ASPECT_RATIO - bh) / 2;
                by0 -= grow;
                by1 += grow;
              } else if (bh / bw > MAX_BOX_ASPECT_RATIO) {
                const grow = (bh / MAX_BOX_ASPECT_RATIO - bw) / 2;
                bx0 -= grow;
                bx1 += grow;
              }
            }
            const bounds = [bx0, by0, bx1, by1] as [number, number, number, number];

            track.setFeature({
              frame: params.frameNum,
              flick: 0,
              bounds,
              keyframe: true,
              interpolate: false,
            }, lineGeometry);

            // Report and store the full stereo measurement on both cameras
            // (length attributes are gated by the length-update feature).
            if (response.measurement && updateLengths) {
              ensureMeasurementAttributes();
              const sourceTrack = cameraStore.getPossibleTrack(params.trackId, params.camera);
              applyStereoMeasurement(sourceTrack, params.frameNum, response.measurement);
              applyStereoMeasurement(track, params.frameNum, response.measurement);
              reportStereoMeasurement(response.measurement);
              await updateStereoTrackAverages(cameraStore, params.trackId);
            }
          }
        } else if (params.type === 'box') {
          // Convert box bounds to 4 corner points
          const [x1, y1, x2, y2] = params.bounds;
          const corners: [number, number][] = [
            [x1, y1], [x2, y1], [x2, y2], [x1, y2],
          ];

          const response = await stereoTransferPoints({ points: corners });
          if (!response.success || !response.transferredPoints) {
            throw new Error(response.error || 'Box transfer returned no result');
          }

          // Compute new bounds from warped corners
          const txs = response.transferredPoints.map((p) => p[0]);
          const tys = response.transferredPoints.map((p) => p[1]);
          const newBounds = [
            Math.min(...txs), Math.min(...tys),
            Math.max(...txs), Math.max(...tys),
          ] as [number, number, number, number];

          const track = getOrCreateStereoTrack(cameraStore, params.trackId, params.camera, otherCamera, params.frameNum);
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
            throw new Error(response.error || 'Polygon transfer returned no result');
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

          const track = getOrCreateStereoTrack(cameraStore, params.trackId, params.camera, otherCamera, params.frameNum);
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
          savePreStereoSegmentationState(
            params.trackId,
            params.frameNum,
            params.camera,
            otherCamera,
            cameraStore,
          );
          // Single round-trip to the segmentation service: it warps the seed to
          // the other camera (configured stereo backend, with median sampling
          // when enabled), segments there, and optionally derives head/tail lines
          // on both cameras plus the measurement.
          const sourceTrack = cameraStore.getPossibleTrack(params.trackId, params.camera);
          const sourcePolygon = getStereoPolygon(sourceTrack, params.frameNum);
          const sourceImagePath = stereoImagePathGetters.value[params.camera]?.(params.frameNum);
          const otherImagePath = stereoImagePathGetters.value[otherCamera]?.(params.frameNum);
          if (!sourceImagePath || !otherImagePath) {
            throw new Error('No image path for one of the stereo cameras');
          }
          // Both stereo cameras share one fps: per-camera -> dataset -> any camera.
          const segFps = stereoCameraFps.value[params.camera]
            || stereoDatasetFps
            || Object.values(stereoCameraFps.value)[0];
          const segFrameTime = segFps ? params.frameNum / segFps : undefined;

          const response = await segmentationStereoSegment({
            polygon: sourcePolygon || undefined,
            points: params.points,
            pointLabels: params.labels,
            sourceImagePath,
            otherImagePath,
            calibrationFile: stereoCalibrationFile,
            frameTime: segFrameTime,
          });
          if (!response.success) {
            throw new Error(response.error || 'Stereo segmentation returned no result');
          }

          // Draw the segmented polygon on the other camera.
          const track = getOrCreateStereoTrack(cameraStore, params.trackId, params.camera, otherCamera, params.frameNum);
          if (track && response.polygon && response.polygon.length >= 3) {
            const closedPolygon = [...response.polygon];
            const first = closedPolygon[0];
            const last = closedPolygon[closedPolygon.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              closedPolygon.push([...first] as [number, number]);
            }
            const segGeometry: GeoJSON.Feature[] = [{
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [closedPolygon] },
              properties: { key: '' },
            }];
            const segBounds = response.bounds || [
              Math.min(...response.polygon.map((p: [number, number]) => p[0])),
              Math.min(...response.polygon.map((p: [number, number]) => p[1])),
              Math.max(...response.polygon.map((p: [number, number]) => p[0])),
              Math.max(...response.polygon.map((p: [number, number]) => p[1])),
            ] as [number, number, number, number];
            track.setFeature({
              frame: params.frameNum,
              flick: 0,
              bounds: segBounds,
              keyframe: true,
              interpolate: false,
            }, segGeometry);
          }

          // Optionally add a head/tail line to each camera and store the
          // length/measurement attributes (as the line-transfer flow does).
          if (response.generateLine) {
            if (response.lineSource) applyStereoLine(sourceTrack, params.frameNum, response.lineSource);
            if (track && response.lineOther) applyStereoLine(track, params.frameNum, response.lineOther);
            if (response.measurement && updateLengths) {
              ensureMeasurementAttributes();
              applyStereoMeasurement(sourceTrack, params.frameNum, response.measurement);
              applyStereoMeasurement(track, params.frameNum, response.measurement);
              reportStereoMeasurement(response.measurement);
              await updateStereoTrackAverages(cameraStore, params.trackId);
            }
          }
        }
        // Success — hide loading dialog
        stereoLoadingDialog.value = false;
      } catch (err) {
        // Surface the failure in the SAME dialog that was showing the
        // "Computing stereo correspondence..." spinner: switch it to its error
        // state (title + message + Close button) rather than hiding it and
        // popping a separate prompt, which flashed two windows in sequence.
        const message = err instanceof Error ? err.message : String(err);
        stereoErrorTitle.value = 'Stereo Transfer Error';
        stereoErrorSeverity.value = 'warning';
        stereoLoadingError.value = `Failed to transfer annotation to the other camera. ${message}`;
        stereoLoadingDialog.value = true;
      }
    }

    /**
     * Undo stereo side effects from interactive segmentation on reset.
     * Restores the other camera and clears saved undo state for the frame.
     */
    async function handleStereoAnnotationReset(params: StereoAnnotationResetParams) {
      const key = `${params.trackId}:${params.frameNum}`;
      const saved = preStereoSegmentationState.get(key);
      if (!saved) return;

      const viewer = viewerRef.value;
      if (!viewer) return;

      const { cameraStore, multiCamList } = viewer;
      if (multiCamList.length < 2) return;

      const otherCamera = multiCamList.find((c: string) => c !== params.sourceCamera);
      if (otherCamera && saved[otherCamera]) {
        restoreStereoCameraState(
          cameraStore,
          params.trackId,
          otherCamera,
          params.frameNum,
          saved[otherCamera],
        );
      }

      preStereoSegmentationState.delete(key);

      if (clientSettings.stereoSettings.updateLengthsOnModify) {
        try {
          await updateStereoTrackAverages(cameraStore, params.trackId);
        } catch (err) {
          console.warn('[Stereo] Failed to update track averages after reset:', err);
        }
      }
    }

    function handleStereoSegmentationFinalize(params?: StereoSegmentationFinalizeParams) {
      if (!params) {
        clearPreStereoSegmentationState();
        return;
      }
      params.frameNums.forEach((frameNum) => {
        preStereoSegmentationState.delete(`${params.trackId}:${frameNum}`);
      });
    }

    async function applyCalibrationAfterImport() {
      try {
        const hasStereo = await loadStereoMetadata();
        if (!hasStereo) return;
        const result = await stereoEnable(undefined, stereoCalibrationFile);
        if (!result.success) return;
        stereoEnabled.value = true;
        await ensureStereoFrame(getViewerFrame());
      } catch (err) {
        console.warn('[Stereo] Failed to apply calibration after import:', err);
      }
    }

    function onCalibrationImported(calibrationPath: string) {
      const dataset = datasets.value[props.id];
      if (dataset) {
        dataset.calibration = calibrationPath;
      }
      stereoCalibrationFile = calibrationPath;
      if (!stereoServiceWanted()) return;
      applyCalibrationAfterImport();
    }

    function onCalibrationDeleted() {
      const dataset = datasets.value[props.id];
      if (dataset) {
        dataset.calibration = undefined;
      }
      stereoCalibrationFile = undefined;
    }

    // Desktop window-close guard: on unsaved changes, offer a native three-way
    // choice (save / discard / cancel) rather than the two-button navigate-away
    // prompt. Resolves true to allow the close, false to keep the app open.
    async function desktopCloseGuard(): Promise<boolean> {
      // Pending annotation saves OR unsaved Camera Registration panel edits.
      const unsaved = viewerRef.value?.hasUnsavedChanges ?? false;
      if (!unsaved) return true;
      const choice = await window.diveDesktop.invoke('desktop:confirm-close-unsaved');
      if (choice === 'cancel') return false;
      if (choice === 'save') {
        try {
          if (viewerRef.value.pendingSaveCount > 0) {
            await viewerRef.value.save();
          }
          await viewerRef.value.saveRegistration();
        } catch {
          // Save failed; the Viewer surfaces its own error, so keep the app open.
          return false;
        }
      }
      return true;
    }

    onMounted(() => {
      setCloseGuard(desktopCloseGuard);
      window.diveDesktop.send('desktop:close-guard-active', true);
    });

    onBeforeUnmount(() => {
      setCloseGuard(null);
      window.diveDesktop.send('desktop:close-guard-active', false);
    });

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
      timeFilter,
      handleTextQuerySubmit,
      handleTextQueryInit,
      handleTextQueryAllFrames,
      textQueryAvailable,
      openLink,
      /* Stereo */
      stereoLoadingDialog,
      stereoLoadingMessage,
      textQueryRunning,
      stereoLoadingError,
      stereoErrorTitle,
      stereoErrorSeverity,
      stereoLengthSnackbar,
      stereoLengthMessage,
      closeStereoLoadingDialog,
      handleStereoAnnotationComplete,
      handleStereoAnnotationReset,
      handleStereoSegmentationFinalize,
      handleStereoTrackLinked,
      onCalibrationImported,
      onCalibrationDeleted,
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
      :text-query-enabled="true"
      :text-query-available="textQueryAvailable"
      @change-camera="changeCamera"
      @large-image-warning="largeImageWarning()"
      @text-query-submit="handleTextQuerySubmit"
      @text-query-init="handleTextQueryInit"
      @text-query-all-frames="handleTextQueryAllFrames"
      @open-external-link="openLink"
      @stereo-annotation-complete="handleStereoAnnotationComplete"
      @stereo-annotation-reset="handleStereoAnnotationReset"
      @stereo-segmentation-finalize="handleStereoSegmentationFinalize"
      @stereo-track-linked="handleStereoTrackLinked"
    >
      <template #dataset-name-prefix>
        <dataset-source-info :dataset-id="id" />
      </template>
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
          :time-filter="timeFilter"
          v-bind="{ buttonOptions, menuOptions }"
        />
        <ImportAnnotations
          :dataset-id="modifiedId"
          :sub-type="subTypeList[0]"
          :calibration-file="datasets[id] && datasets[id].calibration"
          v-bind="{ buttonOptions, menuOptions, readOnlyMode }"
          block-on-unsaved
          @calibration-imported="onCalibrationImported"
        />
        <Export
          v-if="datasets[id]"
          :id="modifiedId"
          v-bind="{ buttonOptions, menuOptions }"
        />
      </template>
      <template #extension-right>
        <CalibrationMenu
          v-if="subTypeList[0] === 'stereo'"
          :dataset-id="modifiedId"
          :calibration-file="datasets[id] && datasets[id].calibration"
          @calibration-deleted="onCalibrationDeleted"
        />
      </template>
      <template #right-sidebar="{ sidebarMode }">
        <SidebarContext :sidebar-mode="sidebarMode">
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
      :value="textQueryRunning"
      persistent
      max-width="420"
    >
      <v-card>
        <v-card-title class="text-h6">
          Text Query
        </v-card-title>
        <v-card-text>
          <div class="mb-2">
            Searching the current frame&hellip;
          </div>
          <v-progress-linear
            indeterminate
            color="primary"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
    <v-dialog
      :value="stereoLoadingDialog"
      persistent
      max-width="560"
    >
      <v-card>
        <v-card-title>{{ stereoLoadingError ? stereoErrorTitle : 'Stereo Service' }}</v-card-title>
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
            :type="stereoErrorSeverity"
            dense
            class="stereo-loading-error"
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
    <v-snackbar
      v-model="stereoLengthSnackbar"
      :timeout="4000"
      bottom
      right
    >
      {{ stereoLengthMessage }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.viewer-loader-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.stereo-loading-error {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
}
</style>
