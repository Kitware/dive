<script lang="ts">
import {
  computed, defineComponent, inject, ref, watch,
} from 'vue';
import type { InjectionKey } from 'vue';
import {
  useDatasetId,
  useReadOnlyMode,
  useSelectedCamera,
  useTime,
} from 'vue-media-annotator/provides';
import { useApi, DatasetMeta, DatasetInfoFields } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useFrameMetadata } from 'dive-common/use';
import CustomDatasetInfoPanel from 'dive-common/components/DatasetInfo/CustomDatasetInfoPanel.vue';
import DatasetInfoPanel from 'dive-common/components/DatasetInfo/DatasetInfoPanel.vue';
import FrameMetadataPanel from 'dive-common/components/DatasetInfo/FrameMetadataPanel.vue';

/** Given a camera key, the viewer's ordered image filenames for it (frame = array index). */
export type GetCameraMediaNames = (camera: string) => string[] | undefined;

/**
 * Injection key for the viewer-held, per-camera ordered image filenames. Viewer.vue provides it;
 * the Frame Info panel feeds it to the shared frame-metadata resolver so the web read path can
 * join sidecar rows to frames in the browser. Undefined when the panel renders outside a viewer.
 */
export const CameraMediaNamesSymbol: InjectionKey<GetCameraMediaNames> = Symbol('cameraMediaNames');

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
    // Viewer.vue provides each camera's ordered image filenames; the web read path joins sidecar
    // rows to frames against them. Absent (undefined) outside a viewer or on the desktop path.
    const getCameraMediaNames = inject(CameraMediaNamesSymbol, undefined);
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

    // One composable, two platforms: platform APIs load declared sidecar texts, and the viewer's
    // ordered media names drive the shared TypeScript resolver. Scrubbing the playhead never
    // refetches (frame drives currentEntries only).
    const frameMetadata = useFrameMetadata({
      datasetId,
      frame: time.frame,
      selectedCamera,
      getCameraMediaNames,
      loadFrameMetadata,
    });

    // Frame metadata exists for image-sequence datasets and multicam parents with image-sequence
    // cameras. A platform lacking the source-text read path is equally unsupported.
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

    // Name the sidecar(s) that fed the active camera's frame metadata; a single
    // dataset can match several telemetry files (precedence order, winner first).
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
        // Render the stored ISO timestamp in the user's locale, matching how
        // dates are shown elsewhere (e.g. ImportDialog, RevisionHistory).
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
