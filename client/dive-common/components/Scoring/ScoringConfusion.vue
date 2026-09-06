<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import ScoringHeatmap from './charts/ScoringHeatmap.vue';

export default defineComponent({
  name: 'ScoringConfusion',
  components: { ScoringHeatmap },
  setup(_, { emit }) {
    const scoring = useScoring();
    const normalized = ref(false);
    const selected = ref<{ row: number; col: number } | null>(null);

    const matrix = computed(() => scoring.metrics.value?.confusionMatrix || null);
    const backgroundIndex = computed(() => (matrix.value ? matrix.value.classNames.indexOf('background') : -1));
    const accuracy = computed(() => scoring.metrics.value?.values.classification_accuracy ?? null);

    function onSelect(cell: { row: number; col: number }) {
      if (!matrix.value) return;
      if (selected.value && selected.value.row === cell.row && selected.value.col === cell.col) {
        selected.value = null;
        emit('filter', null);
        return;
      }
      selected.value = cell;
      const truthClass = matrix.value.classNames[cell.row];
      const computedClass = matrix.value.classNames[cell.col];
      // Background rows are misses, background columns are false alarms
      let status: 'tp' | 'fp' | 'fn' | null = null;
      if (truthClass === 'background') status = 'fp';
      else if (computedClass === 'background') status = 'fn';
      else status = 'tp';
      emit('filter', {
        status,
        gtClass: truthClass === 'background' ? null : truthClass,
        computedClass: computedClass === 'background' ? null : computedClass,
      });
    }

    return {
      matrix,
      normalized,
      selected,
      backgroundIndex,
      accuracy,
      onSelect,
    };
  },
});
</script>

<template>
  <div class="px-2">
    <div
      v-if="!matrix"
      class="text-caption grey--text pa-2"
    >
      No confusion matrix in this result.
    </div>
    <div
      v-else
      class="d-flex flex-wrap"
    >
      <ScoringHeatmap
        :row-labels="matrix.classNames"
        :col-labels="matrix.classNames"
        :counts="matrix.matrix"
        :fractions="matrix.normalized"
        :show-fractions="normalized"
        :background-index="backgroundIndex"
        :selected="selected"
        @select="onSelect"
      />
      <div class="pl-4 pt-2 confusion-side">
        <v-switch
          v-model="normalized"
          dense
          hide-details
          label="Normalize rows"
          class="mt-0"
        />
        <div
          v-if="accuracy !== null"
          class="text-body-2 mt-2"
        >
          Classification accuracy among matches: <b>{{ (accuracy * 100).toFixed(1) }}%</b>
        </div>
        <div class="text-caption grey--text mt-2">
          Rows are truth classes, columns are computed classes. The background row holds
          false positives and the background column holds missed objects. Click a cell to
          browse the objects behind it in the Errors tab.
        </div>
        <div class="text-caption mt-2">
          <div
            v-for="name in matrix.classNames.filter((n) => n !== 'background')"
            :key="name"
          >
            {{ name }}: {{ matrix.perClassAccuracy[name] === null || matrix.perClassAccuracy[name] === undefined ? 'n/a' : `${(matrix.perClassAccuracy[name] * 100).toFixed(1)}%` }} correct
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.confusion-side {
  max-width: 320px;
}
</style>
