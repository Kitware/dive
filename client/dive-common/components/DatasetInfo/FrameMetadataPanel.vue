<script lang="ts">
import {
  defineComponent, PropType,
} from 'vue';

export default defineComponent({
  name: 'FrameMetadataPanel',

  props: {
    entries: {
      type: Array as PropType<[string, string][]>,
      required: true,
    },
    emptyState: {
      type: String,
      required: true,
    },
    sourceLabel: {
      type: String as PropType<string | null>,
      default: null,
    },
  },
});
</script>

<template>
  <v-expansion-panel class="frame-metadata-section">
    <v-expansion-panel-header class="dataset-info-panel-header px-1 py-1 text-subtitle-1 font-weight-medium">
      <span>Frame Metadata</span>
      <v-spacer />
      <v-tooltip
        v-if="sourceLabel"
        bottom
        max-width="320"
      >
        <template #activator="{ on, attrs }">
          <v-icon
            small
            color="grey lighten-1"
            class="frame-metadata-source-icon mr-2"
            :aria-label="sourceLabel"
            v-bind="attrs"
            v-on="on"
          >
            mdi-information-outline
          </v-icon>
        </template>
        <span>{{ sourceLabel }}</span>
      </v-tooltip>
    </v-expansion-panel-header>
    <v-divider />

    <v-expansion-panel-content class="dataset-info-panel-content">
      <v-list
        v-if="entries.length"
        dense
        class="py-0"
      >
        <v-list-item
          v-for="[field, value] in entries"
          :key="`frameMetadata_${field}`"
          class="px-1 frame-metadata-row"
        >
          <v-list-item-content class="d-block py-1">
            <v-list-item-subtitle class="font-weight-medium wrap-text frame-metadata-key">
              {{ field }}
            </v-list-item-subtitle>
            <div
              class="wrap-text frame-metadata-value"
              v-text="value"
            />
          </v-list-item-content>
        </v-list-item>
      </v-list>
      <div
        v-else
        class="pa-2 grey--text"
      >
        {{ emptyState }}
      </div>
    </v-expansion-panel-content>
  </v-expansion-panel>
</template>

<style scoped>
.wrap-text {
  white-space: normal !important;
  overflow-wrap: anywhere;
}

.dataset-info-panel-header {
  min-height: 32px;
}
</style>
