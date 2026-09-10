<script lang="ts">
import {
  computed, defineComponent, PropType, ref,
} from 'vue';
import type { DataTableHeader } from 'vuetify';
import { clientSettings } from 'dive-common/store/settings';
import { itemsPerPageOptions } from 'dive-common/constants';
import {
  DatasetPickerRow, datasetTypeOptions, filterDatasetRows, selectableIds,
} from 'dive-common/datasetPicker';

const DefaultHeaders: DataTableHeader[] = [
  { text: 'Dataset', value: 'name', sortable: true },
  {
    text: 'Type', value: 'type', sortable: true, width: 160,
  },
];

/**
 * The one way datasets are chosen across the app: a searchable, type-filterable
 * list of the datasets on offer, an add button per row, and select all for
 * everything the filters list. Pages keep their own table of what they
 * selected; this only offers. Platforms without a listing (the web) can show a
 * browse button instead, through `pickerLabel` and the `pick` event.
 */
export default defineComponent({
  name: 'DatasetPicker',
  props: {
    /** Datasets on offer, selected ones included (they show as taken). */
    items: {
      type: Array as PropType<DatasetPickerRow[]>,
      required: true,
    },
    selectedIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    /** Columns before the add button; extra values come from the rows. */
    headers: {
      type: Array as PropType<DataTableHeader[]>,
      default: () => DefaultHeaders,
    },
    title: {
      type: String,
      default: '',
    },
    hint: {
      type: String,
      default: '',
    },
    noDataText: {
      type: String,
      default: 'No datasets available.',
    },
    /** Label of a platform browse button; empty hides it. */
    pickerLabel: {
      type: String,
      default: '',
    },
    picking: {
      type: Boolean,
      default: false,
    },
    /** Hide the paging footer for short lists. */
    compact: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    /** Null when the field's clear button is used. */
    const search = ref<string | null>('');
    /** Null means all types; otherwise the selected type string. */
    const typeFilter = ref<string | null>(null);

    const typeOptions = computed(() => datasetTypeOptions(props.items));
    const showTypeFilter = computed(() => props.headers.some((h) => h.value === 'type'));
    const listed = computed(() => filterDatasetRows(
      props.items,
      search.value,
      ['name'],
      typeFilter.value,
    ));
    const addable = computed(() => selectableIds(listed.value, props.selectedIds));
    const selected = computed(() => new Set(props.selectedIds));
    /** Listed rows that are selected: what "remove all" drops. */
    const removable = computed(() => listed.value
      .filter((row) => selected.value.has(row.id))
      .map((row) => row.id));

    const tableHeaders = computed<DataTableHeader[]>(() => [
      ...props.headers,
      {
        text: '', value: 'picker-actions', sortable: false, width: 96, align: 'end',
      },
    ]);

    function rowClass(item: DatasetPickerRow) {
      return selected.value.has(item.id) ? 'picker-row-selected' : '';
    }

    function addAll() {
      if (addable.value.length) emit('add-many', addable.value);
    }

    function removeAll() {
      if (removable.value.length) emit('remove-many', removable.value);
    }

    function setTypeFilter(value: string | null) {
      typeFilter.value = value;
    }

    return {
      search,
      typeFilter,
      typeOptions,
      showTypeFilter,
      listed,
      addable,
      removable,
      selected,
      tableHeaders,
      rowClass,
      addAll,
      removeAll,
      setTypeFilter,
      clientSettings,
      itemsPerPageOptions,
    };
  },
});
</script>

<template>
  <div class="dataset-picker">
    <div
      v-if="title || hint"
      class="mb-1"
    >
      <div
        v-if="title"
        class="text-subtitle-2"
      >
        {{ title }}
      </div>
      <div
        v-if="hint"
        class="text-caption grey--text"
      >
        {{ hint }}
      </div>
    </div>
    <div class="d-flex align-center flex-wrap picker-toolbar mb-1">
      <v-text-field
        v-model="search"
        append-icon="mdi-magnify"
        label="Search datasets"
        dense
        outlined
        single-line
        hide-details
        clearable
        class="picker-search"
      />
      <v-spacer />
      <v-btn
        v-if="pickerLabel"
        small
        outlined
        :loading="picking"
        class="ml-2"
        @click="$emit('pick')"
      >
        <v-icon
          small
          left
        >
          mdi-folder-search
        </v-icon>
        {{ pickerLabel }}
      </v-btn>
      <v-btn
        small
        color="success"
        outlined
        :disabled="addable.length === 0"
        class="ml-2"
        :title="`Add the ${addable.length} listed dataset${addable.length === 1 ? '' : 's'} not yet selected`"
        @click="addAll"
      >
        <v-icon
          small
          left
        >
          mdi-check-all
        </v-icon>
        Select all{{ addable.length ? ` (${addable.length})` : '' }}
      </v-btn>
      <v-btn
        small
        color="error"
        outlined
        :disabled="removable.length === 0"
        class="ml-2"
        :title="`Remove the ${removable.length} listed dataset${removable.length === 1 ? '' : 's'} from the selection`"
        @click="removeAll"
      >
        <v-icon
          small
          left
        >
          mdi-close-box-multiple-outline
        </v-icon>
        Remove all{{ removable.length ? ` (${removable.length})` : '' }}
      </v-btn>
    </div>
    <v-data-table
      dense
      :headers="tableHeaders"
      :items="listed"
      :items-per-page.sync="clientSettings.rowsPerPage"
      :footer-props="{ itemsPerPageOptions }"
      :hide-default-footer="compact && listed.length <= clientSettings.rowsPerPage"
      :no-data-text="items.length ? 'Nothing matches the filters.' : noDataText"
      :item-class="rowClass"
      class="picker-table"
    >
      <template #header.type="{ header }">
        <v-menu
          v-if="showTypeFilter"
          open-on-hover
          bottom
          offset-y
          open-delay="200"
          close-delay="250"
          :nudge-bottom="4"
        >
          <template #activator="{ on, attrs }">
            <span
              class="type-header-label"
              v-bind="attrs"
              v-on="on"
            >
              {{ header.text }}
              <v-icon
                x-small
                class="ml-1"
                :color="typeFilter ? 'primary' : undefined"
                :class="{ 'type-filter-idle': !typeFilter }"
              >
                {{ typeFilter ? 'mdi-filter' : 'mdi-filter-outline' }}
              </v-icon>
            </span>
          </template>
          <v-list dense>
            <v-list-item
              :input-value="!typeFilter"
              @click="setTypeFilter(null)"
            >
              <v-list-item-title>All</v-list-item-title>
            </v-list-item>
            <v-list-item
              v-for="type in typeOptions"
              :key="type"
              :input-value="typeFilter === type"
              @click="setTypeFilter(type)"
            >
              <v-list-item-title>{{ type }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
        <span v-else>{{ header.text }}</span>
      </template>
      <template #[`item.picker-actions`]="{ item }">
        <span class="d-inline-flex align-center">
          <slot
            name="row-actions"
            :item="item"
          />
          <v-btn
            v-if="selected.has(item.id)"
            :key="`${item.id}-remove`"
            icon
            x-small
            color="grey"
            title="Selected; click to remove"
            @click="$emit('remove', item.id)"
          >
            <v-icon small>
              mdi-check
            </v-icon>
          </v-btn>
          <v-btn
            v-else
            :key="`${item.id}-add`"
            icon
            x-small
            color="success"
            title="Add"
            @click="$emit('add', item.id)"
          >
            <v-icon small>
              mdi-plus
            </v-icon>
          </v-btn>
        </span>
      </template>
    </v-data-table>
  </div>
</template>

<style lang="scss" scoped>
.picker-toolbar {
  gap: 4px 0;
}

.picker-search {
  max-width: 360px;
}

.type-header-label {
  display: inline-flex;
  align-items: center;
  cursor: default;
}

.type-filter-idle {
  opacity: 0.45;
}

.picker-table ::v-deep td {
  padding: 2px 8px !important;
}

.picker-table ::v-deep .picker-row-selected td {
  color: #888;
}
</style>
