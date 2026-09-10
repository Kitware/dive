<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useApi } from 'dive-common/apispec';
import { useReview } from 'dive-common/use/useReview';
import DatasetPicker from 'dive-common/components/DatasetPicker.vue';

/**
 * Which datasets the review grid draws from: pick them from the library
 * listing (or the platform's dataset browser on the web), see each one's
 * load state, reload or drop it.
 */
export default defineComponent({
  name: 'ReviewDatasetsPanel',
  components: { DatasetPicker },
  setup() {
    const api = useApi();
    const review = useReview();
    const picking = ref(false);
    const usePicker = computed(() => typeof api.pickScoringDataset === 'function');

    const selectedIds = computed(() => review.datasets.value.map((d) => d.id));

    /** Picked datasets queue up; they load when the Results view opens. */
    async function add(id: string) {
      const summary = review.available.value.find((d) => d.id === id);
      await review.addDataset(id, summary, { defer: true });
    }

    async function addMany(ids: string[]) {
      await Promise.all(ids.map((id) => add(id)));
    }

    function removeMany(ids: string[]) {
      ids.forEach((id) => review.removeDataset(id));
    }

    async function openPicker() {
      if (!api.pickScoringDataset || picking.value) return;
      picking.value = true;
      try {
        const picked = await api.pickScoringDataset(selectedIds.value);
        if (picked) await review.addDataset(picked.id, picked, { defer: true });
      } finally {
        picking.value = false;
      }
    }

    function statusIcon(status: string) {
      if (status === 'ready') return { icon: 'mdi-check-circle', color: 'success' };
      if (status === 'error') return { icon: 'mdi-alert-circle', color: 'error' };
      if (status === 'queued') return { icon: 'mdi-clock-outline', color: 'grey' };
      return { icon: 'mdi-progress-clock', color: 'grey' };
    }

    function statusText(status: string) {
      if (status === 'ready') return 'Ready';
      if (status === 'queued') return 'Loads when Results opens';
      return 'Loading…';
    }

    return {
      review,
      statusText,
      selectedIds,
      add,
      addMany,
      removeMany,
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
    <DatasetPicker
      :items="review.available.value"
      :selected-ids="selectedIds"
      :picker-label="usePicker ? 'Browse…' : ''"
      :picking="picking"
      hint="Every dataset here contributes its annotations to the grid. Multicamera datasets are added one camera at a time."
      no-data-text="No datasets in the library."
      compact
      class="mb-3"
      @add="add"
      @add-many="addMany"
      @remove="review.removeDataset"
      @remove-many="removeMany"
      @pick="openPicker"
    />
    <div class="text-subtitle-2 mb-1">
      Selected datasets ({{ review.datasets.value.length }})
    </div>
    <div
      v-if="review.datasets.value.length === 0"
      class="text-caption grey--text py-2"
    >
      None yet. Add datasets from the list above, or select them in the library and choose Review.
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
              >{{ statusText(dataset.status) }}</span>
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
