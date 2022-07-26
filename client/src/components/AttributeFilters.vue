<script lang="ts">
import {
  computed, defineComponent, PropType, reactive, ref, Ref,
} from '@vue/composition-api';
import { difference, union } from 'lodash';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import type { AttributeFilter } from 'vue-media-annotator/use/useAttributes';
import { useReadOnlyMode } from '../provides';
import TooltipBtn from './TooltipButton.vue';
import StyleManager from '../StyleManager';

interface VirtualTypeItem {
  type: string;
  confidenceFilterNum: number;
  displayText: string;
  color: string;
  checked: boolean;
}

/* Magic numbers involved in height calculation */
const TypeListHeaderHeight = 80;

export default defineComponent({
  name: 'AttributeFilters',

  props: {
    height: {
      type: Number,
      default: 200,
    },
    width: {
      type: Number,
      default: 300,
    },
    attributeFilters: {
      type: Object as PropType<{track: AttributeFilter[]; detection: AttributeFilter[]}>,
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
    const currentTab = ref('Track Filters');

    // Ordering of these lists should match

    const virtualHeight = computed(() => props.height - TypeListHeaderHeight);

    return {
      currentTab,
      virtualHeight,
      readOnlyMode,
      /* methods */
    };
  },
});
</script>

<template>
  <div>
    <v-card>
      <v-card-title>
        <v-tabs v-model="currentTab">
          <v-tab> Track Filters </v-tab>
          <v-tab> Detection Filters</v-tab>
        </v-tabs>
      </v-card-title>
      <v-tabs-items v-model="currentTab">
        <v-tab-item>
          <v-card-text>
            <v-list>
              <v-list-item
                v-for="(filter, index) in attributeFilters"
                :key="`track_${index}`"
              />
            </v-list>
          </v-card-text>
        </v-tab-item>
      </v-tabs-items>
    </v-card>
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
