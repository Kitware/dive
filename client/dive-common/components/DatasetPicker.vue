<script lang="ts">
import {
  computed, defineComponent, nextTick, PropType, ref,
} from 'vue';
import type { DataTableHeader } from 'vuetify';
import { clientSettings } from 'dive-common/store/settings';
import { itemsPerPageOptions } from 'dive-common/constants';
import { DatasetPickerRow, filterDatasetRows, selectableIds } from 'dive-common/datasetPicker';

const DefaultHeaders: DataTableHeader[] = [
  { text: 'Dataset', value: 'name', sortable: true },
  {
    text: 'Type', value: 'type', sortable: true, width: 160,
  },
];

/**
 * The one way datasets are chosen across the app: a searchable list of the
 * datasets on offer, an add button per row, and select all for everything
 * the search lists. Pages keep their own table of what they selected; this
 * only offers. Platforms without a listing (the web) can show a browse
 * button instead, through `pickerLabel` and the `pick` event.
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

    const searchFields = computed(() => props.headers.map((h) => h.value));
    const listed = computed(() => filterDatasetRows(props.items, search.value ?? '', searchFields.value));
    const addable = computed(() => selectableIds(listed.value, props.selectedIds));
    const selected = computed(() => new Set(props.selectedIds));
    /** Listed rows that are selected: what "remove all" drops. */
    const removable = computed(() => listed.value
      .filter((row) => selected.value.has(row.id))
      .map((row) => row.id));
    const root = ref<HTMLElement | null>(null);

    function scrollParentOf(el: HTMLElement): HTMLElement | null {
      let node = el.parentElement;
      while (node) {
        const style = window.getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    /**
     * Run a change, then scroll so the picker stays where it was on screen:
     * pages list their selection above the picker, so adding to it would
     * otherwise push the list the user is working in down the page.
     */
    async function holdInPlace(change: () => void) {
      const el = root.value;
      if (!el) {
        change();
        return;
      }
      const before = el.getBoundingClientRect().top;
      change();
      await nextTick();
      await new Promise((resolve) => { window.requestAnimationFrame(resolve); });
      const delta = el.getBoundingClientRect().top - before;
      if (Math.abs(delta) < 1) return;
      const parent = scrollParentOf(el);
      if (parent) parent.scrollTop += delta;
      else window.scrollBy(0, delta);
    }

    const tableHeaders = computed<DataTableHeader[]>(() => [
      ...props.headers,
      {
        text: '', value: 'picker-actions', sortable: false, width: 96, align: 'end',
      },
    ]);

    function rowClass(item: DatasetPickerRow) {
      return selected.value.has(item.id) ? 'picker-row-selected' : '';
    }

    function add(id: string) {
      holdInPlace(() => emit('add', id));
    }

    function remove(id: string) {
      holdInPlace(() => emit('remove', id));
    }

    function addAll() {
      if (addable.value.length) holdInPlace(() => emit('add-many', addable.value));
    }

    function removeAll() {
      if (removable.value.length) holdInPlace(() => emit('remove-many', removable.value));
    }

    return {
      search,
      listed,
      addable,
      removable,
      selected,
      root,
      tableHeaders,
      rowClass,
      add,
      remove,
      addAll,
      removeAll,
      clientSettings,
      itemsPerPageOptions,
    };
  },
});
</script>

<template>
  <div
    ref="root"
    class="dataset-picker"
  >
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
      :no-data-text="items.length ? 'Nothing matches the search.' : noDataText"
      :item-class="rowClass"
      class="picker-table"
    >
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
            @click="remove(item.id)"
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
            @click="add(item.id)"
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

.picker-table ::v-deep td {
  padding: 2px 8px !important;
}

.picker-table ::v-deep .picker-row-selected td {
  color: #888;
}
</style>
