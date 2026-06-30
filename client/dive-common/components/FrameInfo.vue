<script lang="ts">
import { computed, defineComponent } from 'vue';
import {
  useDatasetId,
  useSelectedCamera,
  useTime,
} from 'vue-media-annotator/provides';

import { useApi } from 'dive-common/apispec';
import { useFrameMetadataWindow } from 'dive-common/use';

export default defineComponent({
  name: 'FrameInfo',

  setup() {
    const datasetId = useDatasetId();
    const selectedCamera = useSelectedCamera();
    const time = useTime();
    const { loadFrameMetadata } = useApi();

    const frameMetadata = useFrameMetadataWindow({
      datasetId,
      frame: time.frame,
      selectedCamera,
      loadFrameMetadata,
    });

    const emptyState = computed(() => {
      if (frameMetadata.unsupported.value) {
        return 'Frame metadata is not supported on this platform.';
      }
      if (frameMetadata.loading.value && !frameMetadata.currentEntries.value.length) {
        return 'Loading frame metadata...';
      }
      if (frameMetadata.error.value) {
        return `Unable to load frame metadata: ${frameMetadata.error.value}`;
      }
      if (!frameMetadata.hasMetadataSource.value) {
        return 'No frame metadata source found. Place a .txt or .csv telemetry file next to the imagery.';
      }
      return 'No frame metadata for the current frame.';
    });

    return {
      currentEntries: frameMetadata.currentEntries,
      emptyState,
    };
  },
});
</script>

<template>
  <section class="frame-info-panel">
    <dl
      v-if="currentEntries.length"
      class="frame-info-list"
    >
      <div
        v-for="[field, value] in currentEntries"
        :key="field"
        class="frame-info-row"
      >
        <dt
          class="frame-info-key"
          v-text="field"
        />
        <dd
          class="frame-info-value"
          v-text="value"
        />
      </div>
    </dl>
    <div
      v-else
      class="frame-info-empty"
    >
      {{ emptyState }}
    </div>
  </section>
</template>

<style scoped lang="scss">
.frame-info-panel {
  padding: 8px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.frame-info-list {
  margin: 0;
}

.frame-info-row {
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.frame-info-row:last-child {
  border-bottom: 0;
}

.frame-info-key {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}

.frame-info-value {
  margin: 2px 0 0;
  font-size: 14px;
  line-height: 1.35;
  white-space: pre-wrap;
}

.frame-info-empty {
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.4;
  padding: 4px 0;
}
</style>
