<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, Ref, PropType,
} from 'vue';

import Viewer from 'dive-common/components/Viewer.vue';
import NavigationTitle from 'dive-common/components/NavigationTitle.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common/components/ImportAnnotations.vue';
import CalibrationMenu from 'dive-common/components/CalibrationMenu.vue';
import SidebarContext from 'dive-common/components/SidebarContext.vue';
import context from 'dive-common/store/context';
import { useBrand } from 'platform/web-girder/store/useBrand';
import { useConfig } from 'platform/web-girder/store/useConfig';
import { useDataset } from 'platform/web-girder/store/useDataset';
import { reportHandledPromiseRejection } from 'platform/web-girder/reportHandledPromiseRejection';
import { useLocation } from 'platform/web-girder/store/useLocation';
import { useJobs } from 'platform/web-girder/store/useJobs';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import type { DatasetCalibrationResult, DatasetType, SubType } from 'dive-common/apispec';
import { useApi } from 'dive-common/apispec';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import { getMultiCamCameraCount } from 'dive-common/pipelineMenuFilters';
import { webExcludedPipelineTerms } from 'dive-common/constants';
import { convertLargeImage } from 'platform/web-girder/api/rpc.service';
import { useRouter, useRoute } from 'vue-router/composables';
import { ANNOTATION_SOURCE_QUERY } from 'dive-common/scoring/viewerNavigation';
import { parseViewerFocus } from 'dive-common/review/viewerNavigation';
import useStereoOnnxWeb from 'platform/web-girder/useStereoOnnxWeb';
import useWebSegmentation from 'platform/web-girder/useWebSegmentation';
import type { StereoModelProgress } from 'platform/web-girder/useStereoOnnxWeb';
import {
  STEREO_LENGTH_METHOD_ATTR, STEREO_MEASUREMENT_ATTRS,
} from 'dive-common/use/stereo/useStereoOnnxTransfer';
import type { StereoMeasurement } from 'dive-common/use/stereo/triangulate';
import {
  STEREO_LENGTH_ATTRIBUTE_NAME, createStereoLengthRendering,
} from 'dive-common/utils/stereoLengthRendering';
import JobsTab from './JobsTab.vue';
import Export from './Export.vue';
import Clone from './Clone.vue';
import ViewerAlert from './ViewerAlert.vue';
import RevisionHistory from './RevisionHistory.vue';
import AnnotationSets from './AnnotationSets.vue';

const buttonOptions = {
  text: true,
  color: 'grey lighten-1',
  outlined: true,
  depressed: true,
  class: ['mx-1'],
};

const menuOptions = {
  offsetY: true,
  bottom: true,
};

context.register({
  component: RevisionHistory,
  description: 'Revision History',
});

context.register({
  component: AnnotationSets,
  description: 'Annotation Sets',
});

/**
 * ViewerLoader is responsible for loading
 * data from girder.
 */
export default defineComponent({
  components: {
    Clone,
    Export,
    JobsTab,
    RunPipelineMenu,
    NavigationTitle,
    Viewer,
    ImportAnnotations,
    CalibrationMenu,
    RevisionHistory,
    SidebarContext,
    ViewerAlert,
    AnnotationSets,
    ...context.getComponents(),
  },

  // TODO: This will require an import from vue-router for Vue3 compatibility
  async beforeRouteLeave(to, from, next) {
    if (await this.viewerRef.navigateAwayGuard()) {
      next();
    }
  },

  props: {
    id: {
      type: String,
      required: true,
    },
    revision: {
      type: String,
      default: undefined,
    },
    set: {
      type: String,
      default: undefined,
    },
    comparisonSets: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },

  setup(props) {
    const { prompt } = usePrompt();
    const router = useRouter();
    const route = useRoute();
    const { getDatasetCalibration } = useApi();
    const viewerRef = ref();
    const calibrationFile = ref<string | null>(null);
    /** Girder item id for the cached stereo rig; used to detect in-place replacements. */
    const calibrationItemId = ref<string | null>(null);
    // Client-side stereo: warp a detection to the other camera via the VIAME
    // "match" ONNX model and triangulate its length, with no backend. No-ops
    // without a 2-camera dataset, a calibration file, and a served model asset.
    const stereoBusyMessage = ref<string | null>(null);
    /** Set only while the ~100 MB model downloads, where the size is known. */
    const stereoDownloadProgress = ref<StereoModelProgress | null>(null);
    const stereoError = ref('');
    const stereoLengthSnackbar = ref(false);
    const stereoLengthMessage = ref('');

    /**
     * Define the stereo measurements as numeric detection attributes so they
     * show up in the Attributes panel, matching the desktop stereo flow.
     */
    function ensureMeasurementAttributes() {
      const viewer = viewerRef.value;
      if (!viewer?.handler?.setAttribute) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (viewer.attributes || []) as any[];
      STEREO_MEASUREMENT_ATTRS.forEach((name) => {
        const attr = existing.find((a) => a.name === name && a.belongs === 'detection');
        const render = name === STEREO_LENGTH_ATTRIBUTE_NAME
          ? { render: createStereoLengthRendering(name) }
          : {};
        if (!attr) {
          viewer.handler.setAttribute({
            data: {
              belongs: 'detection', datatype: 'number', name, key: `detection_${name}`, ...render,
            },
          });
        } else if (name === STEREO_LENGTH_ATTRIBUTE_NAME && !attr.render) {
          viewer.handler.setAttribute({ data: { ...attr, ...render } });
        }
      });
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
      if (!existing.find((a) => a.name === 'avg_length' && a.belongs === 'track')) {
        viewer.handler.setAttribute({
          data: {
            belongs: 'track', datatype: 'number', name: 'avg_length', key: 'track_avg_length',
          },
        });
      }
    }

    const stereo = useStereoOnnxWeb({
      getViewer: () => viewerRef.value,
      getDatasetId: () => parentDatasetId(props.id),
      ensureMeasurementAttributes,
      onStatus: (message, progress) => {
        stereoBusyMessage.value = message;
        stereoDownloadProgress.value = progress?.total ? progress : null;
      },
      onError: (message) => {
        stereoBusyMessage.value = null;
        stereoDownloadProgress.value = null;
        stereoError.value = message;
      },
      onMeasurement: (m: StereoMeasurement) => {
        const round2 = (v: number) => Math.round(v * 100) / 100;
        stereoLengthMessage.value = [
          `Stereo length: ${round2(m.length)}`,
          `range: ${round2(m.midpoint_range)}`,
        ].join('  •  ');
        stereoLengthSnackbar.value = true;
      },
    });

    const {
      handleStereoTrackLinked, warpAllFromCamera, invalidateCalibration, stereoViewLink,
    } = stereo;
    const {
      status: segmentationStatus, progress: segmentationProgress,
      busy: autoPopulateBusy, cancel: cancelAutoPopulate,
      handleNewAnnotationGeometry, handleStereoAnnotationComplete,
      handleStereoAnnotationReset, handleStereoSegmentationFinalize,
    } = useWebSegmentation(() => viewerRef.value, stereo, (message) => { stereoError.value = String(message); });

    function closeStereoError() {
      stereoError.value = '';
    }

    const stereoDownloadPercent = computed(() => {
      const progress = stereoDownloadProgress.value;
      if (!progress) return 0;
      return Math.min(100, (progress.loaded / progress.total) * 100);
    });

    const stereoDownloadLabel = computed(() => {
      const progress = stereoDownloadProgress.value;
      if (!progress) return '';
      const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
      return `${mb(progress.loaded)} of ${mb(progress.total)} MB`;
    });

    /** Model download/prepare uses a dialog; encode/predict stay a light snackbar. */
    const segmentationLoadActive = computed(() => {
      const phase = segmentationProgress.value?.phase;
      return !!segmentationStatus.value && (phase === 'download' || phase === 'prepare');
    });
    const segmentationEncoding = computed(() => {
      const phase = segmentationProgress.value?.phase;
      return !!segmentationStatus.value && (phase === 'encode' || phase === 'predict');
    });
    const segmentationDownloadPercent = computed(() => {
      const progress = segmentationProgress.value;
      if (progress?.phase === 'download' && progress.percent !== undefined) return progress.percent;
      if (progress?.phase === 'prepare') return 100;
      return 0;
    });
    const segmentationPreparing = computed(() => (
      segmentationProgress.value?.phase === 'prepare'
    ));
    const segmentationOnCpu = computed(() => (
      segmentationProgress.value?.device === 'cpu'
    ));
    /**
     * Once per browser session: warn that CPU SAM embedding/auto-populate is slow.
     * Fires on the first download/prepare/encode/predict that actually runs on CPU
     * (forced CPU, no GPU, or auto fallback).
     */
    const CPU_SEG_WARN_KEY = 'dive.sam.cpuModeWarned';
    let cpuSegWarned = false;
    let cpuSegWarnOpen = false;
    watch(
      () => ({
        active: segmentationLoadActive.value || segmentationEncoding.value,
        device: segmentationProgress.value?.device,
      }),
      async ({ active, device }) => {
        if (!active || device !== 'cpu' || cpuSegWarned || cpuSegWarnOpen) return;
        try {
          if (typeof sessionStorage !== 'undefined'
            && sessionStorage.getItem(CPU_SEG_WARN_KEY)) {
            cpuSegWarned = true;
            return;
          }
        } catch {
          /* private mode / blocked storage: still warn once this page load */
        }
        cpuSegWarned = true;
        cpuSegWarnOpen = true;
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(CPU_SEG_WARN_KEY, '1');
          }
        } catch { /* ignore */ }
        await prompt({
          title: 'CPU Segmentation Mode',
          text: [
            'Segmentation is running in CPU mode.',
            'Embedding each new frame and auto-populating masks or points will take significantly longer than on a GPU—typically 5–15 seconds or more per frame (about 10–30× slower).',
            'Later clicks on an already-embedded frame stay quick. You can switch devices under Track Settings if a hardware GPU is available.',
          ],
        });
        cpuSegWarnOpen = false;
      },
    );
    /**
     * Import menu "Warp to All": push every detection the imported camera holds
     * onto the other camera, then save. `resolve` keeps the import spinner up
     * until the warp finishes.
     */
    async function handleStereoWarpImported(sourceCamera: string, resolve?: () => void) {
      try {
        const counts = await warpAllFromCamera(sourceCamera);
        if (counts?.transferred) await viewerRef.value?.save();
      } catch (err) {
        stereoError.value = `Failed to warp imported detections. ${(err as Error).message}`;
      } finally {
        resolve?.();
      }
    }
    const { brandData } = useBrand();
    const {
      pipelinesEnabled,
      jobsDisabled,
      jobsDisabledMessage,
    } = useConfig();
    const { meta: datasetMeta, loadDataset } = useDataset();
    const jobs = useJobs();
    const { locationRoute } = useLocation();
    const revisionNum = computed(() => {
      const parsed = Number.parseInt(props.revision, 10);
      if (Number.isNaN(parsed)) return undefined;
      return parsed;
    });
    const currentJob = computed(() => jobs.getDatasetCompleteJobs(parentDatasetId(props.id)));

    const typeList = computed((): DatasetType[] => {
      const t = datasetMeta.value?.type;
      return t ? [t as DatasetType] : [];
    });
    const subTypeList = computed((): SubType[] => [datasetMeta.value?.subType ?? null]);
    const cameraNumbers = computed(() => [getMultiCamCameraCount(datasetMeta.value ? {
      type: datasetMeta.value.type,
      multiCamMedia: datasetMeta.value.multiCamMedia ?? undefined,
    } : undefined)]);
    const timeFilter: Ref<[number, number] | null> = ref(null);
    // Track the active camera so single-camera pipelines target that folder
    // (parentId/cameraName), matching desktop ViewerLoader behavior.
    const selectedCamera = ref('');
    function changeCamera(cameraName: string) {
      selectedCamera.value = cameraName;
    }
    // Prefer the @change-camera event, then Viewer's live selection, then the
    // multicam defaultDisplay once meta for this dataset is loaded. Avoids a
    // window where modifiedId is still the parent id and single-cam pipes 400.
    const modifiedId = computed(() => {
      const parentId = parentDatasetId(props.id);
      const viewerCam = viewerRef.value?.selectedCamera as string | undefined;
      const meta = datasetMeta.value;
      const metaMatches = meta != null && (meta.id === parentId || meta.id === props.id);
      const camera = selectedCamera.value
        || (viewerCam && viewerCam !== 'singleCam' ? viewerCam : '')
        || (metaMatches ? meta.multiCamMedia?.defaultDisplay : undefined)
        || '';
      if (camera) {
        return `${parentId}/${camera}`;
      }
      return props.id;
    });

    // Held as computeds rather than inline `[modifiedId]` / `[id]` in the
    // template: an inline array is a new value on every re-render, which makes
    // the menus re-look-up the dataset's calibration on every click.
    const pipelineDatasetIds = computed(() => [modifiedId.value]);
    const exportDatasetIds = computed(() => [props.id]);

    watch(() => props.id, (datasetId) => {
      selectedCamera.value = '';
      loadDataset(datasetId).catch((reason) => {
        reportHandledPromiseRejection('ViewerLoader: loadDataset', reason);
      });
    }, { immediate: true });

    // Seed as soon as parent meta arrives so pipeline menus don't wait on Viewer emit.
    watch(datasetMeta, (meta) => {
      if (selectedCamera.value || !meta?.multiCamMedia?.defaultDisplay) {
        return;
      }
      const parentId = parentDatasetId(props.id);
      if (meta.id === parentId || meta.id === props.id) {
        selectedCamera.value = meta.multiCamMedia.defaultDisplay;
      }
    });

    /**
     * Keep the stereo ONNX cache in sync with whatever calibration the menus
     * are showing. A same-name replacement still changes itemId, so both are
     * compared; invalidate when either differs so the next warp re-downloads.
     */
    function applyCalibrationResult(result: DatasetCalibrationResult | null | undefined) {
      const nextName = result?.originalName ?? result?.jsonPath ?? result?.path ?? null;
      const nextItemId = result?.itemId ?? result?.jsonItemId ?? null;
      if (nextName === calibrationFile.value && nextItemId === calibrationItemId.value) {
        return;
      }
      invalidateCalibration();
      calibrationFile.value = nextName;
      calibrationItemId.value = nextItemId;
    }

    async function refreshCalibrationFile() {
      if (!getDatasetCalibration || subTypeList.value[0] !== 'stereo') {
        applyCalibrationResult(null);
        return;
      }
      try {
        const result = await getDatasetCalibration(parentDatasetId(props.id));
        applyCalibrationResult(result);
      } catch {
        applyCalibrationResult(null);
      }
    }

    watch(
      () => [props.id, subTypeList.value[0]] as const,
      () => {
        refreshCalibrationFile().catch((reason) => {
          reportHandledPromiseRejection('ViewerLoader: refreshCalibrationFile', reason);
        });
      },
      { immediate: true },
    );

    function onCalibrationImported(name: string) {
      // Item id is unknown until the next server refresh / conversion poll.
      calibrationFile.value = name;
      calibrationItemId.value = null;
      invalidateCalibration();
    }

    function onCalibrationDeleted() {
      calibrationFile.value = null;
      calibrationItemId.value = null;
      invalidateCalibration();
    }

    watch(
      () => viewerRef.value?.trackFilters?.timeFilters?.value,
      (value) => {
        timeFilter.value = value ?? null;
      },
      { immediate: true },
    );
    const runningPipelines = computed(() => {
      const results: string[] = [];
      // Jobs on a camera child are attributed to the multicam parent id.
      if (jobs.getDatasetRunningState(parentDatasetId(props.id))) {
        results.push(modifiedId.value);
        results.push(parentDatasetId(props.id));
      }
      return results;
    });

    if (props.revision) {
      /* When a revision is loaded, toggle the revision history on */
      context.state.active = 'RevisionHistory';
    }

    watch(currentJob, async () => {
      if (currentJob.value !== false && currentJob.value !== undefined) {
        if (currentJob.value.type === 'scoring') {
          // Scoring never touches the annotations; the scoring page picks up the result
          jobs.removeCompleteJob({ datasetId: parentDatasetId(props.id) });
          return;
        }
        if (currentJob.value.success) {
          const result = await prompt({
            title: 'Pipeline Finished',
            text: [`Pipeline: ${currentJob.value.title}`,
              'finished running on the current dataset.  Click reload to load the annotations.  The current annotations will be replaced with the pipeline output.',
            ],
            confirm: true,
            positiveButton: 'Reload',
            negativeButton: '',
          });
          jobs.removeCompleteJob({ datasetId: parentDatasetId(props.id) });
          if (result) {
            viewerRef.value.reloadAnnotations();
          }
        } else {
          await prompt({
            title: 'Pipeline Incomplete',
            text: [`Pipeline: ${currentJob.value.title}`,
              'either failed or was cancelled by the user',
            ],
          });
          jobs.removeCompleteJob({ datasetId: parentDatasetId(props.id) });
        }
      }
    });

    onMounted(() => {
      window.addEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });

    function routeRevision(revisionId: number | undefined, set?: string) {
      if (set && set !== 'default' && revisionId !== undefined) {
        router.replace({
          name: 'revision set viewer',
          params: { id: props.id, revision: revisionId.toString(), set },
        });
      } else if (revisionId === undefined) {
        router.replace({
          name: 'viewer',
          params: { id: props.id },
        });
      } else {
        router.replace({
          name: 'revision viewer',
          params: { id: props.id, revision: revisionId.toString() },
        });
      }
    }

    function routeSet(set: string) {
      if (set === 'default') {
        router.replace({
          name: 'viewer',
          params: { id: props.id },
        });
      } else {
        router.replace({
          name: 'set viewer',
          params: { id: props.id, set },
        });
      }
      viewerRef.value.reloadAnnotations();
    }

    async function largeImageWarning() {
      const result = await prompt({
        title: 'Large Image Warning',
        text: ['The current Image Sequence dataset has a large resolution',
          'This may prevent the image from being shown on certain hardware/browsers',
          'This can be automatically converted to a tiled Large Image for proper viewing',
        ],
        confirm: true,
        positiveButton: 'Convert',
        negativeButton: 'Cancel',

      });
      if (result) {
        convertLargeImage(props.id);
      }
    }

    const annotationSourceLabel = computed(() => {
      const value = route.query[ANNOTATION_SOURCE_QUERY];
      return typeof value === 'string' ? value : '';
    });
    const annotationSourceReturnable = computed(() => !!annotationSourceLabel.value);
    /** Frame / track deep link from the review grid. */
    const viewerFocus = computed(() => parseViewerFocus(route.query));

    function returnToCurrentAnnotations() {
      router.replace({ name: 'viewer', params: { id: props.id } });
    }

    return {
      buttonOptions,
      brandData,
      context,
      menuOptions,
      revisionNum,
      viewerRef,
      jobs,
      locationRoute,
      datasetMeta,
      currentJob,
      runningPipelines,
      routeRevision,
      routeSet,
      largeImageWarning,
      typeList,
      subTypeList,
      cameraNumbers,
      timeFilter,
      pipelinesEnabled,
      jobsDisabled,
      jobsDisabledMessage,
      webExcludedPipelineTerms,
      calibrationFile,
      applyCalibrationResult,
      onCalibrationImported,
      onCalibrationDeleted,
      changeCamera,
      modifiedId,
      pipelineDatasetIds,
      exportDatasetIds,
      handleStereoAnnotationComplete,
      handleStereoTrackLinked,
      stereoViewLink,
      segmentationStatus,
      segmentationLoadActive,
      segmentationEncoding,
      segmentationDownloadPercent,
      segmentationPreparing,
      segmentationOnCpu,
      autoPopulateBusy,
      cancelAutoPopulate,
      handleNewAnnotationGeometry,
      handleStereoAnnotationReset,
      handleStereoSegmentationFinalize,
      stereoBusyMessage,
      stereoDownloadProgress,
      stereoDownloadPercent,
      stereoDownloadLabel,
      stereoError,
      stereoLengthSnackbar,
      stereoLengthMessage,
      closeStereoError,
      handleStereoWarpImported,
      annotationSourceLabel,
      annotationSourceReturnable,
      viewerFocus,
      returnToCurrentAnnotations,
    };
  },
});
</script>

<template>
  <div class="viewer-loader-wrapper">
    <Viewer
      :id="id"
      :key="id"
      ref="viewerRef"
      :revision="revisionNum"
      :current-set="set"
      :read-only-mode="!!jobs.getDatasetRunningState(id)"
      :comparison-sets="comparisonSets"
      :annotation-source-label="annotationSourceLabel"
      :annotation-source-returnable="annotationSourceReturnable"
      :initial-frame="viewerFocus.frame"
      :initial-track-id="viewerFocus.trackId"
      :stereo-view-link="stereoViewLink"
      :auto-populate-busy="autoPopulateBusy"
      :auto-populate-status="segmentationStatus"
      @return-to-current-annotations="returnToCurrentAnnotations"
      @large-image-warning="largeImageWarning()"
      @update:set="routeSet"
      @change-camera="changeCamera"
      @stereo-annotation-complete="handleStereoAnnotationComplete"
      @new-annotation-geometry="handleNewAnnotationGeometry"
      @stereo-annotation-reset="handleStereoAnnotationReset"
      @stereo-segmentation-finalize="handleStereoSegmentationFinalize"
      @stereo-track-linked="handleStereoTrackLinked"
      @cancel-auto-populate="cancelAutoPopulate"
    >
      <template #title>
        <ViewerAlert />
        <NavigationTitle :name="brandData.name" />
        <v-tabs
          icons-and-text
          hide-slider
          class="mx-2"
          style="flex-basis:0; flex-grow:0;"
        >
          <v-tab :to="locationRoute">
            Data
            <v-icon>mdi-database</v-icon>
          </v-tab>
          <JobsTab />
          <v-tab
            :to="{ name: 'review', query: { fromDataset: id } }"
          >
            Review
            <v-icon>mdi-view-grid-outline</v-icon>
          </v-tab>
        </v-tabs>
      </template>
      <template #title-right>
        <RunPipelineMenu
          v-if="pipelinesEnabled"
          :before-run="() => viewerRef.save(set)"
          v-bind="{
            buttonOptions,
            menuOptions,
            typeList,
            subTypeList,
            cameraNumbers,
          }"
          :selected-dataset-ids="pipelineDatasetIds"
          :running-pipelines="runningPipelines"
          :read-only-mode="revisionNum !== undefined"
          :time-filter="timeFilter"
          :exclude-pipeline-terms="webExcludedPipelineTerms"
          :jobs-disabled="jobsDisabled"
          :jobs-disabled-message="jobsDisabledMessage"
        />
        <ImportAnnotations
          :button-options="buttonOptions"
          :menu-options="menuOptions"
          :read-only-mode="!!jobs.getDatasetRunningState(id) || revisionNum !== undefined"
          :dataset-id="modifiedId"
          :sub-type="subTypeList[0]"
          :calibration-file="calibrationFile"
          block-on-unsaved
          @calibration-imported="onCalibrationImported"
          @stereo-warp-imported="handleStereoWarpImported"
        />
        <Export
          v-bind="{ buttonOptions, menuOptions }"
          :dataset-ids="exportDatasetIds"
          block-on-unsaved
        />
        <Clone
          v-if="datasetMeta"
          v-bind="{ buttonOptions, menuOptions }"
          :dataset-id="id"
          :revision="revisionNum"
        />
      </template>
      <template #extension-right>
        <CalibrationMenu
          v-if="subTypeList[0] === 'stereo'"
          :dataset-id="id"
          :calibration-file="calibrationFile"
          @calibration-updated="applyCalibrationResult"
          @calibration-deleted="onCalibrationDeleted"
        />
      </template>
      <template #right-sidebar="{ sidebarMode }">
        <SidebarContext :sidebar-mode="sidebarMode">
          <template #default="{ name, subCategory }">
            <component
              :is="name"
              :sub-category="subCategory"
              @update:revision="routeRevision"
            />
          </template>
        </SidebarContext>
      </template>
    </Viewer>
    <v-dialog
      :value="!!stereoBusyMessage || !!stereoError"
      persistent
      max-width="560"
    >
      <v-card>
        <v-card-title>{{ stereoError ? 'Annotation Error' : 'Interactive Stereo' }}</v-card-title>
        <v-card-text>
          <div v-if="!stereoError">
            <div class="d-flex align-center">
              <v-progress-circular
                v-if="!stereoDownloadProgress"
                indeterminate
                color="primary"
                class="mr-3"
              />
              {{ stereoBusyMessage }}
            </div>
            <template v-if="stereoDownloadProgress">
              <v-progress-linear
                :value="stereoDownloadPercent"
                color="primary"
                height="8"
                rounded
                class="mt-3"
              />
              <div class="text-caption mt-1">
                {{ stereoDownloadLabel }}
              </div>
            </template>
          </div>
          <v-alert
            v-else
            type="warning"
            dense
            class="stereo-loading-error"
          >
            {{ stereoError }}
          </v-alert>
        </v-card-text>
        <v-card-actions v-if="stereoError">
          <v-spacer />
          <v-btn
            text
            @click="closeStereoError"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      :value="segmentationLoadActive"
      persistent
      max-width="560"
    >
      <v-card>
        <v-card-title>Segmentation model</v-card-title>
        <v-card-text>
          <v-alert
            v-if="segmentationOnCpu"
            type="warning"
            dense
            text
            class="mb-3"
          >
            Running on CPU. Embedding each new frame and auto-populating
            masks or points will take significantly longer (typically 5–15
            seconds or more per frame).
          </v-alert>
          <div>{{ segmentationStatus }}</div>
          <div class="mb-3 mt-3">
            <div>
              Download {{ Math.floor(segmentationDownloadPercent) }}%
            </div>
            <v-progress-linear
              aria-label="Segmentation model download progress"
              :value="segmentationDownloadPercent"
              :indeterminate="false"
              color="primary"
              height="8"
              rounded
              class="mt-1"
            />
          </div>
          <div>
            <div>Prepare</div>
            <v-progress-linear
              aria-label="Segmentation model prepare progress"
              :value="0"
              :indeterminate="segmentationPreparing"
              color="primary"
              height="8"
              rounded
              class="mt-1"
            />
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
    <v-snackbar :value="segmentationEncoding" :timeout="-1" bottom left>
      <v-progress-circular indeterminate size="18" width="2" class="mr-2" />
      {{ segmentationStatus }}
    </v-snackbar>
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
