<script lang="ts">
import {
  computed, defineComponent, PropType, reactive, ref, Ref,
} from '@vue/composition-api';
import { difference, union } from 'lodash';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import type { AttributeFilter, AttributeNumberFilter, AttributeStringFilter } from 'vue-media-annotator/use/useAttributes';
import AttributeNumberFilterVue from 'vue-media-annotator/components/AttributeFilter/AttributeNumberFilter.vue';
import { useAttributesFilters, useReadOnlyMode } from '../provides';
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
  },

  components: { TooltipBtn, AttributeNumberFilter: AttributeNumberFilterVue },

  setup(props) {
    const { prompt } = usePrompt();
    const readOnlyMode = useReadOnlyMode();
    const currentTab: Ref<'track' | 'detection'> = ref('track');
    const tabMap = ref(['track', 'detection']);
    const {
      attributeFilters, addAttributeFilter, deleteAttributeFilter, modifyAttributeFilter,
    } = useAttributesFilters();

    // Ordering of these lists should match

    const virtualHeight = computed(() => props.height - TypeListHeaderHeight);

    const getComponentType = (type: AttributeFilter['dataType']) => {
      if (type === 'number') {
        return 'attribute-number-filter';
      } if (type === 'boolean') {
        return 'attribute-bool-filter';
      } if (type === 'text') {
        return 'attribute-string-filter';
      }
      return '';
    };

    const deleteFilter = async (index: number, tab: 'track' | 'detection') => {
      // Delete the filter
      const result = await prompt({
        title: 'Delete Filter?',
        text: 'Are you sure you want to delete this fitler?',
        confirm: true,
      });
      if (result) {
        //Delete the filter
        deleteAttributeFilter(index, tab);
      }
    };
    const addFilter = (tab: 'track' | 'detection') => {
      // add Filter
      const newFilter: AttributeFilter = {
        dataType: 'number',
        filterData: {
          type: 'range',
          range: [0, 1.0],
          value: 0.10,
          comp: '>',
          active: false,
          appliedTo: ['all'],
        },
      };
      addAttributeFilter(0, tab, newFilter);
    };
    const modifyFilter = (index: number, tab: 'track' | 'detection', filter: AttributeFilter['filterData']) => {
      const list = attributeFilters.value[tab];
      if (index < list.length) {
        const item: AttributeFilter = list[index];
        item.filterData = filter;
        modifyAttributeFilter(index, tab, item);
      }
    };
    const updateValue = (index: number, tab: 'track' | 'detection', value: number | string[]) => {
      const list = attributeFilters.value[tab];
      if (index < list.length) {
        const item: AttributeFilter = list[index];
        if (typeof (value) === 'number') {
          (item.filterData as AttributeNumberFilter).value = value;
        } else if (Array.isArray(value)) {
          (item.filterData as AttributeStringFilter).value = value;
        }
        modifyAttributeFilter(index, tab, item);
      }
    };
    const updateActive = (index: number, tab: 'track' | 'detection', active: boolean) => {
      const list = attributeFilters.value[tab];
      if (index < list.length) {
        const item: AttributeFilter = list[index];
        item.filterData.active = active;
        modifyAttributeFilter(index, tab, item);
      }
    };

    return {
      currentTab,
      virtualHeight,
      readOnlyMode,
      attributeFilters,
      tabMap,
      /* methods */
      getComponentType,
      deleteFilter,
      addFilter,
      modifyFilter,
      updateValue,
      updateActive,
    };
  },
});
</script>

<template>
  <div>
    <v-card class="pa-0">
      <v-card-title class="pa-0">
        <v-select
          v-model="currentTab"
          :items="tabMap"
          label="Type"
        />
      </v-card-title>
      <v-card-text>
        <div
          v-for="(filter, index) in attributeFilters[currentTab]"
          :key="`track_${index}`"
          no-gutters
        >
          <component
            :is="getComponentType(filter.dataType)"
            :attribute-filter="filter.filterData"
            @delete="deleteFilter(index, currentTab)"
            @update-value="updateValue(index, currentTab, $event)"
            @update-active="updateActive(index, currentTab, $event)"
            @save-changes="modifyFilter(index, currentTab, $event)"
          />
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          color="success"
          tooltip-text="Add Filter"
          @click="addFilter(currentTab)"
        >
          Add Filter
        </v-btn>
      </v-card-actions>
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
