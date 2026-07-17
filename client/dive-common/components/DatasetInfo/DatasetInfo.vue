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
import { useApi, DatasetMeta, DatasetInfoFields } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useFrameMetadata } from 'dive-common/use';
import CustomDatasetInfoPanel from 'dive-common/components/DatasetInfo/CustomDatasetInfoPanel.vue';
import DatasetInfoPanel from 'dive-common/components/DatasetInfo/DatasetInfoPanel.vue';
import FrameMetadataPanel from 'dive-common/components/DatasetInfo/FrameMetadataPanel.vue';

export default defineComponent({
  name: 'DatasetInfo',

  components: {
    CustomDatasetInfoPanel,
    DatasetInfoPanel,
    FrameMetadataPanel,
  },

  setup() {
    const datasetId = useDatasetId();
    const readOnlyMode = useReadOnlyMode();
    const selectedCamera = useSelectedCamera();
    const time = useTime();
    const {
      loadMetadata,
      saveMetadata,
      loadFrameMetadata,
    } = useApi();
    const mediaController = injectAggregateController();
    const getCameraMediaNames = (camera: string) => {
      try {
        return mediaController.value.getController(camera).filenames.value;
      } catch {
        return undefined;
      }
    };
    const { prompt } = usePrompt();
    const meta = ref<DatasetMeta | null>(null);
    const customDatasetInfo = ref<DatasetInfoFields>({});
    const openInfoPanels = ref([0, 1, 2]);

    const fetchMetadata = async () => {
      if (!datasetId.value) {
        meta.value = null;
        customDatasetInfo.value = {};
        return;
      }
      meta.value = await loadMetadata(datasetId.value);
      customDatasetInfo.value = { ...(meta.value.datasetInfo || {}) };
    };

    watch(datasetId, fetchMetadata, { immediate: true });

    const frameMetadata = useFrameMetadata({
      datasetId,
      frame: time.frame,
      selectedCamera,
      getCameraMediaNames,
      loadFrameMetadata,
    });

    const frameMetadataUnsupported = computed(() => {
      const noReadPath = loadFrameMetadata === undefined;
      const unsupportedType = meta.value !== null
        && meta.value.type !== 'image-sequence'
        && meta.value.type !== 'multi';
      return noReadPath || unsupportedType;
    });

    const frameMetadataEmptyState = computed(() => {
      if (frameMetadata.loading.value && !frameMetadata.currentEntries.value.length) {
        return 'Loading frame metadata...';
      }
      if (frameMetadata.error.value) {
        return `Unable to load frame metadata: ${frameMetadata.error.value}`;
      }
      if (frameMetadataUnsupported.value) {
        return 'Frame metadata is available for image-sequence datasets only.';
      }
      if (frameMetadata.hasSidecarItems.value && !frameMetadata.hasMetadataSource.value) {
        const names = frameMetadata.sidecarSourceNames.value.join(', ');
        return `A frame metadata file (${names}) is present but none of its rows matched this dataset's image filenames — check its filename column.`;
      }
      if (!frameMetadata.hasMetadataSource.value) {
        return 'No frame metadata source found. Add frame-metadata.csv or frame-metadata.txt beside the imagery.';
      }
      return 'No frame metadata for the current frame.';
    });

    const frameMetadataSourceLabel = computed(() => {
      const files = frameMetadata.currentSources.value;
      if (!files.length) {
        return null;
      }
      const [first, ...rest] = files;
      return rest.length
        ? `Source: ${first} (+${rest.length} more matching files)`
        : `Source: ${first}`;
    });

    const infoRows = computed(() => {
      const m = meta.value;
      if (!m) {
        return [];
      }
      const rows: { name: string; value: unknown }[] = [
        { name: 'Name', value: m.name },
        { name: 'Type', value: m.type },
        { name: 'FPS', value: m.fps },
      ];
      if (m.originalFps !== undefined && m.originalFps !== null) {
        rows.push({ name: 'Original FPS', value: m.originalFps });
      }
      if (m.subType) {
        rows.push({ name: 'Subtype', value: m.subType });
      }
      if (m.createdAt) {
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
        await saveMetadata(datasetId.value, { datasetInfo: { ...customDatasetInfo.value } });
      } catch (err) {
        const saveErr = err as { response?: { status?: number } };
        const status = saveErr.response?.status;
        const text = status === 403
          ? 'You do not have permission to save dataset info to this dataset.'
          : 'Unable to save dataset info.';
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
      frameMetadataEntries: frameMetadata.currentEntries,
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
        <FrameMetadataPanel
          :entries="frameMetadataEntries"
          :empty-state="frameMetadataEmptyState"
          :source-label="frameMetadataSourceLabel"
        />

        <DatasetInfoPanel :rows="infoRows" />

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
.dataset-info-panels ::v-deep .v-expansion-panel-content__wrap {
  padding: 0;
}
</style>
