<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useApi } from 'dive-common/apispec';
import { useScoring } from 'dive-common/use/useScoring';
import type { ScoringSource } from 'dive-common/scoring/types';
import ScoringSourceSelect from './ScoringSourceSelect.vue';

export default defineComponent({
  name: 'ScoringPairsTable',
  components: { ScoringSourceSelect },
  setup(_, { emit }) {
    const api = useApi();
    const scoring = useScoring();
    const toAdd = ref<string | null>(null);
    const picking = ref(false);

    const usePicker = computed(() => typeof api.pickScoringDataset === 'function');

    const addable = computed(() => {
      const used = new Set(scoring.pairs.value.map((p) => p.computed.datasetId));
      return scoring.datasets.value
        .filter((d) => !used.has(d.id))
        .map((d) => ({ value: d.id, text: d.name }));
    });

    async function add(id: string | null) {
      if (!id) return;
      await scoring.addDataset(id);
      toAdd.value = null;
    }

    async function openPicker() {
      if (!api.pickScoringDataset || picking.value) return;
      picking.value = true;
      try {
        const used = scoring.pairs.value.map((p) => p.computed.datasetId);
        const picked = await api.pickScoringDataset(used);
        if (picked) await scoring.addDataset(picked.id, picked);
      } finally {
        picking.value = false;
      }
    }

    return {
      scoring,
      toAdd,
      addable,
      add,
      usePicker,
      picking,
      openPicker,
      open: (source: ScoringSource) => emit('open-viewer', source),
    };
  },
});
</script>

<template>
  <div>
    <div class="d-flex align-center mb-2 flex-wrap">
      <v-btn
        v-if="usePicker"
        small
        outlined
        :loading="picking"
        @click="openPicker"
      >
        <v-icon
          small
          left
        >
          mdi-plus
        </v-icon>
        Add sequence
      </v-btn>
      <v-autocomplete
        v-else
        v-model="toAdd"
        :items="addable"
        label="Add a sequence"
        dense
        outlined
        hide-details
        clearable
        class="add-select"
        @change="add"
      />
      <span class="text-caption grey--text ml-3 hidden-md-and-down">
        Each sequence is scored against its own truth; metrics are pooled.
      </span>
    </div>
    <div
      v-if="scoring.pairs.value.length === 0"
      class="text-caption grey--text py-2"
    >
      No sequences yet. Add one above, or select datasets in the library and choose Score.
    </div>
    <v-simple-table
      v-else
      dense
      class="pairs-table"
    >
      <thead>
        <tr>
          <th>Sequence</th>
          <th>Computed annotations</th>
          <th />
          <th>Ground truth</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(pair, i) in scoring.pairs.value"
          :key="pair.computed.datasetId"
        >
          <td class="sequence-cell">
            <a @click="open(pair.computed)">{{ scoring.datasetName(pair.computed.datasetId) }}</a>
          </td>
          <td>
            <ScoringSourceSelect
              :source="pair.computed"
              :media-dataset-id="pair.computed.datasetId"
              title="Computed annotations"
              @update:source="scoring.setComputed(i, $event)"
            />
          </td>
          <td class="px-0">
            <v-tooltip bottom>
              <template #activator="{ on }">
                <v-btn
                  icon
                  x-small
                  v-on="on"
                  @click="scoring.swapPair(i)"
                >
                  <v-icon small>
                    mdi-swap-horizontal
                  </v-icon>
                </v-btn>
              </template>
              <span>Swap computed and truth</span>
            </v-tooltip>
          </td>
          <td>
            <ScoringSourceSelect
              :source="pair.truth"
              :media-dataset-id="pair.computed.datasetId"
              title="Ground truth annotations"
              @update:source="scoring.setTruth(i, $event)"
            />
          </td>
          <td class="px-0">
            <v-btn
              icon
              x-small
              @click="scoring.removePair(i)"
            >
              <v-icon small>
                mdi-close
              </v-icon>
            </v-btn>
          </td>
        </tr>
      </tbody>
    </v-simple-table>
  </div>
</template>

<style lang="scss" scoped>
.add-select {
  max-width: 360px;
}

.sequence-cell {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pairs-table ::v-deep td {
  padding: 4px 6px !important;
}
</style>
