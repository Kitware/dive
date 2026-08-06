<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import {
  useDatasetId,
  useReadOnlyMode,
  useSelectedCamera,
  useTime,
} from 'vue-media-annotator/provides';
import { injectAggregateController } from 'vue-media-annotator/components';
import type { MediaControllerKind } from 'vue-media-annotator/components/annotators/mediaControllerType';
import { useApi, DatasetConfig, DatasetInfoFields } from 'dive-common/apispec';
import type { FrameMetadataFrameContext } from 'dive-common/frameMetadata/resolve';
import { METADATA_ATTACHMENT_UNAVAILABLE } from 'dive-common/frameMetadata/readability';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useFrameMetadata } from 'dive-common/use';
import CustomDatasetInfoPanel from 'dive-common/components/DatasetInfo/CustomDatasetInfoPanel.vue';
import DatasetInfoSection from 'dive-common/components/DatasetInfo/DatasetInfoSection.vue';

export default defineComponent({
  name: 'DatasetInfo',

  components: {
    CustomDatasetInfoPanel,
    DatasetInfoSection,
  },

  setup() {
    const datasetId = useDatasetId();
    const readOnlyMode = useReadOnlyMode();
    const selectedCamera = useSelectedCamera();
    const time = useTime();
    const {
      loadConfig,
      saveConfig,
      loadFrameMetadata,
    } = useApi();
    const mediaController = injectAggregateController();
    const getCameraController = (camera: string) => {
      try {
        return mediaController.value.getController(camera);
      } catch {
        return undefined;
      }
    };
    const getCameraFrameContext = (
      camera: string,
    ): FrameMetadataFrameContext | undefined => {
      const controller = getCameraController(camera);
      if (controller === undefined) {
        return undefined;
      }
      if (controller.mediaKind === 'image-sequence') {
        // ImageAnnotator assigns filenames synchronously in setup(), while `ready` only flips
        // once the first image has downloaded and decoded. Gating on `ready` here would park
        // the panel in `pending` for the whole of that download.
        const mediaNames = controller.filenames.value;
        return mediaNames.length ? { mediaType: 'image-sequence', mediaNames } : undefined;
      }
      if (controller.mediaKind === 'video' && controller.ready.value) {
        // Video sets maxFrame and `ready` in the same loadedMetadata() callback, so the frame
        // bound is only trustworthy once ready.
        return { mediaType: 'video', frameCount: controller.maxFrame.value + 1 };
      }
      return undefined;
    };
    const selectedMediaKind = computed<MediaControllerKind | undefined>(
      () => getCameraController(selectedCamera.value)?.mediaKind,
    );
    // False when the aligned multicam timeline puts the active camera on a slot it never
    // captured: its pane shows "No frame at this instant" while `time.frame` still points at
    // the previous local frame, whose row must not be presented as this instant's metadata.
    const selectedCameraHasFrame = computed(
      () => getCameraController(selectedCamera.value)?.hasFrame.value ?? true,
    );
    const { prompt } = usePrompt();
    const meta = ref<DatasetConfig | null>(null);
    const customDatasetInfo = ref<DatasetInfoFields>({});
    const openInfoPanels = ref([0, 1, 2]);

    const fetchMetadata = async () => {
      if (!datasetId.value) {
        meta.value = null;
        customDatasetInfo.value = {};
        return;
      }
      meta.value = await loadConfig(datasetId.value);
      customDatasetInfo.value = { ...(meta.value.datasetInfo || {}) };
    };

    watch(datasetId, fetchMetadata, { immediate: true });

    const frameMetadata = useFrameMetadata({
      datasetId,
      frame: time.frame,
      selectedCamera,
      getCameraFrameContext,
      loadFrameMetadata,
    });

    const frameMetadataRows = computed(() => (
      selectedCameraHasFrame.value
        ? frameMetadata.currentEntries.value.map(([name, value]) => ({ name, value }))
        : []
    ));

    const frameMetadataUnsupported = computed(
      () => (selectedMediaKind.value ?? meta.value?.type) === 'large-image',
    );

    const frameMetadataEmptyState = computed(() => {
      if (frameMetadata.loading.value) {
        return 'Loading frame metadata...';
      }
      if (frameMetadata.error.value) {
        return `Unable to load frame metadata: ${frameMetadata.error.value}`;
      }
      if (frameMetadataUnsupported.value) {
        return 'Frame metadata is available for image-sequence and video datasets only.';
      }
      if (!selectedCameraHasFrame.value) {
        return 'This camera has no frame at the current time.';
      }
      // The composable's attachment state is the whole taxonomy; re-deriving any part of it
      // here would blame the user's file for states it does not describe.
      const name = frameMetadata.attachmentName.value;
      const reason = frameMetadata.attachmentError.value;
      switch (frameMetadata.attachmentState.value) {
        case 'none':
          return 'No frame metadata source found. Add a TXT or CSV Metadata File when creating the dataset.';
        case 'pending':
          return 'Waiting for frame information.';
        case 'opaque':
          return `The metadata attachment (${name}) is available to pipelines, but only TXT and CSV files can be read as frame metadata.`;
        case 'unavailable':
          // Several backend conditions share this state (the attachment is gone, or more than one
          // reserved-name attachment competes for the slot, in which case `name` is a placeholder).
          // Only the backend's own reason separates them, so forward it verbatim -- except the
          // generic one, which says no more than this sentence already does.
          return reason === undefined || reason === METADATA_ATTACHMENT_UNAVAILABLE
            ? `The metadata attachment (${name}) could not be read.`
            : `The metadata attachment (${name}) could not be read: ${reason}`;
        case 'invalid':
          return `The metadata attachment (${name}) could not be parsed as frame metadata.`;
        case 'unmatched':
          return selectedMediaKind.value === 'video'
            ? `A metadata attachment (${name}) is present, but none of its rows contained a valid DIVE frame number for this video.`
            : `A metadata attachment (${name}) is present, but none of its rows matched this dataset's frames by filename, DIVE frame number, or source image counter.`;
        default:
          return 'No frame metadata for the current frame.';
      }
    });

    const frameMetadataSourceLabel = computed(() => {
      const name = frameMetadata.resolvedSourceName.value;
      return name === undefined ? null : `Source: ${name}`;
    });

    const infoRows = computed(() => {
      const m = meta.value;
      if (!m) {
        return [];
      }
      const rows: { name: string; value: string }[] = [
        { name: 'Name', value: m.name },
        { name: 'Type', value: m.type },
        { name: 'FPS', value: `${m.fps}` },
      ];
      if (m.originalFps !== undefined && m.originalFps !== null) {
        rows.push({ name: 'Original FPS', value: `${m.originalFps}` });
      }
      if (m.subType) {
        rows.push({ name: 'Subtype', value: m.subType });
      }
      if (m.createdAt) {
        // Render the stored ISO timestamp in the user's locale, matching how dates are shown
        // elsewhere (e.g. ImportDialog, RevisionHistory).
        const created = new Date(m.createdAt);
        rows.push({
          name: 'Created',
          value: Number.isNaN(created.getTime()) ? m.createdAt : created.toLocaleString(),
        });
      }
      rows.push({ name: 'ID', value: m.id });
      return rows;
    });

    const persist = async () => {
      if (!datasetId.value) {
        return;
      }
      try {
        await saveConfig(datasetId.value, { datasetInfo: { ...customDatasetInfo.value } });
      } catch (err) {
        const saveErr = err as { response?: { status?: number } };
        const status = saveErr.response?.status;
        const text = status === 403
          ? 'You do not have permission to save dataset info to this dataset.'
          : 'Unable to save dataset info.';
        // Keep the user's edits on screen and let them retry the save manually.
        const retry = await prompt({
          title: 'Error while Saving Dataset Info',
          text,
          positiveButton: 'Retry',
          negativeButton: 'Dismiss',
          confirm: true,
        });
        if (retry) {
          await persist();
        }
      }
    };

    const applyDatasetInfo = (next: DatasetInfoFields) => {
      customDatasetInfo.value = next;
      persist();
    };

    return {
      readOnlyMode,
      openInfoPanels,
      frameMetadataRows,
      frameMetadataEmptyState,
      frameMetadataSourceLabel,
      infoRows,
      customDatasetInfo,
      applyDatasetInfo,
    };
  },
});
</script>

<template>
  <div>
    <v-container>
      <v-expansion-panels
        v-model="openInfoPanels"
        multiple
        flat
        class="dataset-info-panels"
      >
        <DatasetInfoSection
          class="frame-metadata-section"
          title="Frame Metadata"
          :rows="frameMetadataRows"
          :empty-state="frameMetadataEmptyState"
          :source-label="frameMetadataSourceLabel"
        />

        <DatasetInfoSection
          class="dataset-info-section mt-3"
          title="Dataset Info"
          :rows="infoRows"
          empty-state="No dataset info available."
        />

        <CustomDatasetInfoPanel
          :dataset-info="customDatasetInfo"
          :read-only="readOnlyMode"
          @change="applyDatasetInfo"
        />
      </v-expansion-panels>
    </v-container>
  </div>
</template>

<style scoped>
/*
 * One owner of the layout every section in this panel shares, including the editable custom
 * section: the sections themselves declare no presentation of their own.
 */
.dataset-info-panels ::v-deep .v-expansion-panel-content__wrap {
  padding: 0;
}

.dataset-info-panels ::v-deep .dataset-info-panel-header {
  min-height: 32px;
}

.dataset-info-panels ::v-deep .wrap-text {
  white-space: normal !important;
  overflow-wrap: anywhere;
}
</style>
