<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { REVIEW_GRID_LIMITS, ReviewGridSettings } from 'dive-common/review/types';

/**
 * The grid-shape, zoom, context and paging controls shared by chip grids.
 * Extra controls go in the `before` (left) and default (middle) slots.
 */
export default defineComponent({
  name: 'ReviewGridControls',
  props: {
    grid: {
      type: Object as PropType<ReviewGridSettings>,
      required: true,
    },
    page: {
      type: Number,
      required: true,
    },
    pageCount: {
      type: Number,
      required: true,
    },
    /** Text describing the item count, shown before the pager. */
    countLabel: {
      type: String,
      default: '',
    },
    canZoomIn: {
      type: Boolean,
      default: true,
    },
    canZoomOut: {
      type: Boolean,
      default: true,
    },
  },
  setup() {
    return { limits: REVIEW_GRID_LIMITS };
  },
});
</script>

<template>
  <div class="review-controls d-flex align-center flex-wrap px-2 py-1">
    <slot name="before" />
    <span class="text-caption grey--text mr-1">Grid</span>
    <v-text-field
      :value="grid.columns"
      type="number"
      :min="limits.columns[0]"
      :max="limits.columns[1]"
      dense
      outlined
      hide-details
      class="grid-number"
      title="Columns"
      @change="$emit('set-columns', Number($event))"
    />
    <span class="text-caption grey--text mx-1">×</span>
    <v-text-field
      :value="grid.rows"
      type="number"
      :min="limits.rows[0]"
      :max="limits.rows[1]"
      dense
      outlined
      hide-details
      class="grid-number"
      title="Rows"
      @change="$emit('set-rows', Number($event))"
    />
    <v-btn
      icon
      small
      title="Zoom out: more, smaller entries"
      :disabled="!canZoomOut"
      @click="$emit('zoom', 1)"
    >
      <v-icon small>
        mdi-magnify-minus-outline
      </v-icon>
    </v-btn>
    <v-btn
      icon
      small
      title="Zoom in: fewer, larger entries"
      :disabled="!canZoomIn"
      class="mr-3"
      @click="$emit('zoom', -1)"
    >
      <v-icon small>
        mdi-magnify-plus-outline
      </v-icon>
    </v-btn>
    <span
      class="text-caption grey--text mr-2 text-no-wrap"
      title="Extra image shown around each box, as a fraction of the box size"
    >Context {{ Math.round(grid.padding * 100) }}%</span>
    <v-slider
      :value="grid.padding"
      :min="limits.padding[0]"
      :max="limits.padding[1]"
      step="0.05"
      hide-details
      class="padding-slider mr-3"
      @input="$emit('set-padding', Number($event))"
    />
    <slot />
    <v-spacer />
    <span
      v-if="countLabel"
      class="text-caption grey--text mr-2 text-no-wrap"
    >{{ countLabel }}</span>
    <v-btn
      icon
      small
      :disabled="page === 0"
      @click="$emit('update:page', page - 1)"
    >
      <v-icon>mdi-chevron-left</v-icon>
    </v-btn>
    <span class="text-caption mx-1 text-no-wrap">Page {{ page + 1 }} / {{ pageCount }}</span>
    <v-btn
      icon
      small
      :disabled="page >= pageCount - 1"
      @click="$emit('update:page', page + 1)"
    >
      <v-icon>mdi-chevron-right</v-icon>
    </v-btn>
  </div>
</template>

<style lang="scss" scoped>
.review-controls {
  flex: 0 0 auto;
  gap: 4px 0;
  border-top: 1px solid #333;
  border-bottom: 1px solid #333;
}

.grid-number {
  max-width: 66px;
  font-size: 0.75rem;

  ::v-deep input {
    font-size: 0.75rem;
    font-weight: 500;
  }
}

.padding-slider {
  min-width: 170px;
  max-width: 260px;
}
</style>
