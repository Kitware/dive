<script lang="ts">
import {
  defineComponent, PropType,
} from 'vue';

interface DatasetInfoRow {
  name: string;
  value: unknown;
}

export default defineComponent({
  name: 'DatasetInfoPanel',

  props: {
    rows: {
      type: Array as PropType<DatasetInfoRow[]>,
      required: true,
    },
  },
});
</script>

<template>
  <v-expansion-panel class="dataset-info-section mt-3">
    <v-expansion-panel-header class="dataset-info-panel-header px-1 py-1 text-subtitle-1 font-weight-medium">
      Dataset Info
    </v-expansion-panel-header>
    <v-divider />

    <v-expansion-panel-content class="dataset-info-panel-content">
      <v-list
        v-if="rows.length"
        dense
        class="py-0"
      >
        <v-list-item
          v-for="row in rows"
          :key="`datasetInfo_${row.name}`"
          class="px-1"
        >
          <v-list-item-content class="d-block py-1">
            <v-list-item-subtitle class="font-weight-medium wrap-text">
              {{ row.name }}
            </v-list-item-subtitle>
            <div class="wrap-text">
              {{ row.value?.toString() ?? '' }}
            </div>
          </v-list-item-content>
        </v-list-item>
      </v-list>
      <div
        v-else
        class="pa-2 grey--text"
      >
        No dataset info available.
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
