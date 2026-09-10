<script lang="ts">
import {
  computed, defineComponent, PropType, ref,
} from 'vue';
import type { VideoSearchIndexMethod } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import type { QueryPageState } from 'platform/desktop/frontend/useQueryPage';

const IndexMethodItems: { text: string; value: VideoSearchIndexMethod }[] = [
  { text: 'Around generic detections', value: 'detections' },
  { text: 'Detection and tracking', value: 'tracking' },
  { text: 'Around existing annotations', value: 'existing' },
];

/**
 * Which datasets queries search: add them from the library listing, see
 * whether each one is in the search index, and build or drop indexes for
 * several at once.
 */
export default defineComponent({
  name: 'QueryDatasetsPanel',
  props: {
    page: {
      type: Object as PropType<QueryPageState>,
      required: true,
    },
  },
  setup(props, { emit }) {
    const { prompt } = usePrompt();
    const toAdd = ref<string | null>(null);
    const method = ref<VideoSearchIndexMethod>('detections');
    const selected = ref<string[]>([]);

    const addable = computed(() => {
      const used = new Set(props.page.datasets.value.map((d) => d.id));
      return props.page.available.value
        .filter((d) => !used.has(d.id))
        .map((d) => ({ value: d.id, text: d.name }));
    });

    async function add(id: string | null) {
      if (!id) return;
      toAdd.value = null;
      await props.page.addDataset(id);
    }

    const buildable = computed(() => props.page.datasets.value
      .filter((d) => selected.value.includes(d.id) && d.index !== 'building')
      .map((d) => d.id));

    const unindexedIds = computed(() => props.page.datasets.value
      .filter((d) => d.index === 'not-indexed' || d.index === 'error')
      .map((d) => d.id));

    function buildSelected() {
      props.page.buildIndex(buildable.value, method.value);
    }

    function buildUnindexed() {
      props.page.buildIndex(unindexedIds.value, method.value);
    }

    async function removeIndex(id: string) {
      const ok = await prompt({
        title: 'Remove From Search Index',
        text: [`Remove ${props.page.datasetName(id)} from the search index?`,
          'It can be indexed again later, but indexing takes time.'],
        confirm: true,
        positiveButton: 'Remove',
        negativeButton: 'Cancel',
      });
      if (ok) await props.page.removeFromIndex(id);
    }

    function toggleAll(on: boolean) {
      selected.value = on ? props.page.datasets.value.map((d) => d.id) : [];
    }

    function indexBadge(state: string) {
      switch (state) {
        case 'indexed': return { icon: 'mdi-check-circle', color: 'success', text: 'Indexed' };
        case 'building': return { icon: 'mdi-progress-wrench', color: 'primary', text: 'Building index…' };
        case 'not-indexed': return { icon: 'mdi-circle-outline', color: 'grey', text: 'Not indexed' };
        case 'error': return { icon: 'mdi-alert-circle', color: 'error', text: 'Error' };
        default: return { icon: 'mdi-progress-clock', color: 'grey', text: 'Checking…' };
      }
    }

    return {
      toAdd,
      addable,
      add,
      method,
      methodItems: IndexMethodItems,
      selected,
      buildable,
      unindexedIds,
      buildSelected,
      buildUnindexed,
      removeIndex,
      toggleAll,
      indexBadge,
      open: (id: string) => emit('open-dataset', id),
    };
  },
});
</script>

<template>
  <div class="query-datasets">
    <div class="d-flex align-center flex-wrap mb-2 add-row">
      <v-autocomplete
        v-model="toAdd"
        :items="addable"
        label="Add a dataset"
        dense
        outlined
        hide-details
        clearable
        class="add-select"
        @change="add"
      />
      <span class="text-caption grey--text ml-3">
        Queries search the indexed datasets listed here. Build an index for a dataset before searching it.
      </span>
    </div>
    <div
      v-if="page.datasets.value.length === 0"
      class="text-caption grey--text py-2"
    >
      No datasets yet. Add one above, or select datasets in the library and choose Query.
    </div>
    <template v-else>
      <div class="d-flex align-center flex-wrap mb-2 build-row">
        <v-select
          v-model="method"
          :items="methodItems"
          label="Index type"
          dense
          outlined
          hide-details
          class="method-select mr-2"
        />
        <v-btn
          small
          depressed
          color="primary"
          :disabled="buildable.length === 0 || page.installed.value === false"
          class="mr-2"
          @click="buildSelected"
        >
          <v-icon
            small
            left
          >
            mdi-database-plus
          </v-icon>
          Build index for {{ buildable.length }} selected
        </v-btn>
        <v-btn
          small
          outlined
          :disabled="unindexedIds.length === 0 || page.installed.value === false"
          @click="buildUnindexed"
        >
          Build all not indexed ({{ unindexedIds.length }})
        </v-btn>
        <span
          v-if="page.installed.value === false"
          class="text-caption error--text ml-3"
        >
          Video search tools were not found in the VIAME install.
        </span>
      </div>
      <v-simple-table
        dense
        class="datasets-table"
      >
        <thead>
          <tr>
            <th class="check-cell">
              <v-simple-checkbox
                :value="selected.length > 0 && selected.length === page.datasets.value.length"
                :indeterminate="selected.length > 0 && selected.length < page.datasets.value.length"
                dense
                @input="toggleAll"
              />
            </th>
            <th>Dataset</th>
            <th>Type</th>
            <th>Search index</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="dataset in page.datasets.value"
            :key="dataset.id"
          >
            <td class="check-cell">
              <v-simple-checkbox
                :value="selected.includes(dataset.id)"
                dense
                @input="selected = $event ? [...selected, dataset.id] : selected.filter((id) => id !== dataset.id)"
              />
            </td>
            <td class="name-cell">
              <a @click="open(dataset.id)">{{ dataset.name }}</a>
            </td>
            <td class="text-caption">
              {{ dataset.type || '' }}
            </td>
            <td>
              <span class="d-inline-flex align-center">
                <v-icon
                  small
                  :color="indexBadge(dataset.index).color"
                  class="mr-1"
                >
                  {{ indexBadge(dataset.index).icon }}
                </v-icon>
                <span
                  class="text-caption"
                  :class="dataset.index === 'error' ? 'error--text' : 'grey--text'"
                >{{ dataset.index === 'error' && dataset.error ? dataset.error : indexBadge(dataset.index).text }}</span>
              </span>
            </td>
            <td class="text-right actions-cell">
              <v-btn
                v-if="dataset.index === 'indexed'"
                icon
                x-small
                title="Remove from the search index"
                @click="removeIndex(dataset.id)"
              >
                <v-icon small>
                  mdi-database-minus
                </v-icon>
              </v-btn>
              <v-btn
                icon
                x-small
                title="Re-check index status"
                :disabled="dataset.index === 'building'"
                @click="page.refreshIndexStatus(dataset.id)"
              >
                <v-icon small>
                  mdi-refresh
                </v-icon>
              </v-btn>
              <v-btn
                icon
                x-small
                title="Remove from this list"
                @click="page.removeDataset(dataset.id)"
              >
                <v-icon small>
                  mdi-close
                </v-icon>
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-simple-table>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.add-row,
.build-row {
  gap: 4px;
}

.add-select {
  max-width: 360px;
}

.method-select {
  max-width: 260px;
}

.check-cell {
  width: 36px;
}

.name-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-cell {
  white-space: nowrap;
}

.datasets-table ::v-deep td {
  padding: 4px 8px !important;
}
</style>
