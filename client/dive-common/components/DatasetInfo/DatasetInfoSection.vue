<script lang="ts">
import {
  defineComponent, PropType,
} from 'vue';

export interface DatasetInfoSectionRow {
  name: string;
  value: string;
}

/**
 * One read-only expansion-panel section of the Dataset Info sidebar: a titled list of
 * name/value rows, an empty state, and an optional source attribution.
 *
 * Presentation lives here alone so the sections cannot drift apart. Layout that is shared with
 * the editable custom-info section is owned by DatasetInfo.vue instead.
 */
export default defineComponent({
  name: 'DatasetInfoSection',

  props: {
    title: {
      type: String,
      required: true,
    },
    rows: {
      type: Array as PropType<DatasetInfoSectionRow[]>,
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
  <v-expansion-panel>
    <v-expansion-panel-header class="dataset-info-panel-header px-1 py-1 text-subtitle-1 font-weight-medium">
      <span>{{ title }}</span>
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
            class="info-source-icon mr-2"
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

    <v-expansion-panel-content>
      <v-list
        v-if="rows.length"
        dense
        class="py-0"
      >
        <v-list-item
          v-for="(row, index) in rows"
          :key="`${title}_${index}`"
          class="px-1 info-row"
        >
          <v-list-item-content class="d-block py-1">
            <v-list-item-subtitle class="font-weight-medium wrap-text info-key">
              {{ row.name }}
            </v-list-item-subtitle>
            <div
              class="wrap-text info-value"
              v-text="row.value"
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
