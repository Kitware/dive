<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useApi } from 'dive-common/apispec';
import { useReview } from 'dive-common/use/useReview';

/**
 * Which datasets the review grid draws from: add through the platform's
 * dataset picker (web) or a listing (desktop), see each one's load state,
 * reload or drop it.
 */
export default defineComponent({
  name: 'ReviewDatasetsPanel',
  setup() {
    const api = useApi();
    const review = useReview();
    const toAdd = ref<string | null>(null);
    const picking = ref(false);
    const usePicker = computed(() => typeof api.pickScoringDataset === 'function');

    const addable = computed(() => {
      const used = new Set(review.datasets.value.map((d) => d.id));
      return review.available.value
        .filter((d) => !used.has(d.id))
        .map((d) => ({ value: d.id, text: d.name }));
    });

    async function add(id: string | null) {
      if (!id) return;
      const summary = review.available.value.find((d) => d.id === id);
      toAdd.value = null;
      await review.addDataset(id, summary);
    }

    async function openPicker() {
      if (!api.pickScoringDataset || picking.value) return;
      picking.value = true;
      try {
        const used = review.datasets.value.map((d) => d.id);
        const picked = await api.pickScoringDataset(used);
        if (picked) await review.addDataset(picked.id, picked);
      } finally {
        picking.value = false;
      }
    }

    function statusIcon(status: string) {
      if (status === 'ready') return { icon: 'mdi-check-circle', color: 'success' };
      if (status === 'error') return { icon: 'mdi-alert-circle', color: 'error' };
      return { icon: 'mdi-progress-clock', color: 'grey' };
    }

    return {
      review,
      toAdd,
      addable,
      add,
      usePicker,
      picking,
      openPicker,
      statusIcon,
    };
  },
});
</script>

<template>
  <div class="review-datasets">
    <div class="d-flex align-center flex-wrap mb-2 add-row">
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
        Add dataset
      </v-btn>
      <v-autocomplete
        v-else
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
        Every dataset here contributes its annotations to the grid. Multicamera datasets are added one camera at a time.
      </span>
    </div>
    <div
      v-if="review.datasets.value.length === 0"
      class="text-caption grey--text py-2"
    >
      No datasets yet. Add one above, or select datasets in the library and choose Review.
    </div>
    <v-simple-table
      v-else
      dense
      class="datasets-table"
    >
      <thead>
        <tr>
          <th>Dataset</th>
          <th>Type</th>
          <th class="text-right">
            Tracks
          </th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="dataset in review.datasets.value"
          :key="dataset.id"
        >
          <td class="name-cell">
            <a @click="$emit('open-dataset', dataset.id)">{{ dataset.name }}</a>
          </td>
          <td class="text-caption">
            {{ dataset.type || '' }}
          </td>
          <td class="text-right">
            {{ dataset.status === 'ready' ? dataset.trackCount : '' }}
          </td>
          <td>
            <span class="d-inline-flex align-center">
              <v-icon
                small
                :color="statusIcon(dataset.status).color"
                class="mr-1"
              >
                {{ statusIcon(dataset.status).icon }}
              </v-icon>
              <span
                v-if="dataset.status === 'error'"
                class="text-caption error--text"
              >{{ dataset.error }}</span>
              <span
                v-else-if="dataset.status === 'ready' && !dataset.croppable"
                class="text-caption warning--text"
              >Loaded; media cannot be cropped into chips</span>
              <span
                v-else
                class="text-caption grey--text"
              >{{ dataset.status === 'ready' ? 'Ready' : 'Loading…' }}</span>
            </span>
          </td>
          <td class="text-right actions-cell">
            <v-btn
              icon
              x-small
              title="Reload annotations"
              :disabled="dataset.status === 'loading'"
              @click="review.reloadDataset(dataset.id)"
            >
              <v-icon small>
                mdi-refresh
              </v-icon>
            </v-btn>
            <v-btn
              icon
              x-small
              title="Remove from review"
              @click="review.removeDataset(dataset.id)"
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
.add-row {
  gap: 4px;
}

.add-select {
  max-width: 360px;
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
