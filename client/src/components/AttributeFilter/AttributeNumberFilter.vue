<script lang="ts">
import {
  computed, defineComponent, PropType, ref,
} from '@vue/composition-api';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import type { AttributeNumberFilter } from 'vue-media-annotator/use/useAttributes';
import { useReadOnlyMode } from '../../provides';
import TooltipBtn from '../TooltipButton.vue';
import StyleManager from '../../StyleManager';


/* Magic numbers involved in height calculation */
const TypeListHeaderHeight = 80;

export default defineComponent({
  name: 'AttributeNumberFilter',

  props: {
    attributeFilter: {
      type: Object as PropType<AttributeNumberFilter>,
      required: true,
    },
    styleManager: {
      type: Object as PropType<StyleManager>,
      required: true,
    },
  },

  components: { TooltipBtn },

  setup(props) {
    const { prompt } = usePrompt();
    const readOnlyMode = useReadOnlyMode();

    // Ordering of these lists should match
    return {
      /* methods */
    };
  },
});
</script>

<template>
  <div>
    <div v-if="attributeFilter.filterData.type === 'ranges'">
      <v-switch v-model="attributeFilter.invert" />
      <div
        v-for="(item, index) in attributeFilter.ranges"
        :key="`range_${index}`"
      >
        <v-text-field
          :value="item[0]"
          :disabled="disabled"
          hide-details
          single-line
          dense
          :step="item[0]/10.0"
          type="number"
          label="Lower Range"
          :max="item[1]"
          :rules="[
            (v) => v <= item[1] || 'End must be < Upper Range',
          ]"
        />
        <v-text-field
          :value="item[1]"
          :disabled="disabled"
          hide-details
          single-line
          dense
          :step="item[1]/10.0"
          type="number"
          label="Lower Range"
          :min="item[0]"
          :rules="[
            (v) => v >= item[0] || 'End must be > Lower Range',
          ]"
        />
      </div>
    </div>
    <div v-else-if="attributeFilter.filterData.type === 'top'">
      <v-text-field
        :value="item[1]"
        :disabled="disabled"
        hide-details
        single-line
        dense
        :step="item[1]/10.0"
        type="number"
        label="Top X items"
        :min="item[0]"
        :rules="[
          (v) => v >= 0|| 'range must be greater than 0',
        ]"
      />
    </div>
  </div>
</template>

<style scoped lang='scss'>
@import 'src/components/styles/common.scss';

.border-highlight {
   border-bottom: 1px solid gray;
 }

.type-checkbox {
  max-width: 80%;
  overflow-wrap: anywhere;
}

.hover-show-parent {
  .hover-show-child {
    display: none;
  }

  &:hover {
    .hover-show-child {
      display: inherit;
    }
  }
}
.outlined {
  background-color: gray;
  color: #222;
  font-weight: 600;
  border-radius: 6px;
  padding: 0 5px;
  font-size: 12px;
}
</style>
