<script lang="ts">
import {
  computed, defineComponent, ref, Ref,
} from '@vue/composition-api';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import type {
  Attribute, AttributeFilter, AttributeNumberFilter, AttributeStringFilter,
} from 'vue-media-annotator/use/useAttributes';
import AttributeNumberFilterVue from 'vue-media-annotator/components/AttributeFilter/AttributeNumberFilter.vue';
import AttributeNumberFilterSettings from 'vue-media-annotator/components/AttributeFilter/AttributeNumberFilterSettings.vue';
import AttributeStringFilterVue from 'vue-media-annotator/components/AttributeFilter/AttributeStringFilter.vue';
import AttributeStringFilterSettings from 'vue-media-annotator/components/AttributeFilter/AttributeStringFilterSettings.vue';
import AttributeKeyFilterVue from 'vue-media-annotator/components/AttributeFilter/AttributeKeyFilter.vue';
import AttributeKeyFilterSettings from 'vue-media-annotator/components/AttributeFilter/AttributeKeyFilterSettings.vue';
import { useAttributes, useAttributesFilters, useReadOnlyMode } from '../provides';
import TooltipBtn from './TooltipButton.vue';

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

  components: {
    TooltipBtn,
    AttributeNumberFilter: AttributeNumberFilterVue,
    AttributeStringFilter: AttributeStringFilterVue,
    AttributeKeyFilter: AttributeKeyFilterVue,
    AttributeKeyFilterSettings,
    AttributeStringFilterSettings,
    AttributeNumberFilterSettings,
  },

  setup(props) {
    const { prompt } = usePrompt();
    const readOnlyMode = useReadOnlyMode();
    const attributesList = useAttributes();
    const currentTab: Ref<'track' | 'detection'> = ref('track');
    const tabMap = ref(['track', 'detection']);
    const filterTypes = ref([
      { type: 'number', description: 'Filter Number values by their range or display Top X number values' },
      { type: 'text', description: 'Filter Text values by their value.  Starting with, containing or equaling a list of values' },
      { type: 'key', description: 'Filter based on Key Names to only show a subset of attributes' },
      //TODO ADD in Boolean Filter
      //{ type: 'bool', description: 'Filter Boolean values. If value is (True) or not (False)' },
    ]);
    const addFilterDialog = ref(false);
    const selectedAddFilterType: Ref<Attribute['datatype'] | 'key'> = ref('number');
    const {
      attributeFilters, addAttributeFilter, deleteAttributeFilter, modifyAttributeFilter,
    } = useAttributesFilters();

    const addFilterPosition = ref(1);
    const addFilterFilter: Ref<AttributeFilter | null> = ref(null);

    // Ordering of these lists should match

    const virtualHeight = computed(() => props.height - TypeListHeaderHeight);

    const filterNames = computed(() => {
      const data = ['all'];
      return data.concat(attributesList.value.map((item) => item.name));
    });

    const getComponentType = (type: AttributeFilter['dataType'] | 'key') => {
      if (type === 'number') {
        return 'attribute-number-filter';
      } if (type === 'boolean') {
        return 'attribute-bool-filter';
      } if (type === 'text') {
        return 'attribute-string-filter';
      } if (type === 'key') {
        return 'attribute-key-filter';
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
    const addFilter = (filterType: Attribute['datatype'] | 'key') => {
      // add Filter
      let newFilter: AttributeFilter = {
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
      if (filterType === 'text') {
        newFilter = {
          dataType: 'text',
          filterData: {
            value: ['test'],
            comp: 'contains',
            active: false,
            appliedTo: ['all'],
          },
        };
      }
      if (filterType === 'key') {
        newFilter = {
          dataType: 'key',
          filterData: {
            type: 'key',
            value: true,
            active: false,
            appliedTo: ['all'],
          },
        };
      }
      addFilterFilter.value = newFilter;
      addFilterPosition.value = 2;
    };

    const finalizeFilter = () => {
      if (addFilterFilter.value !== null) {
        addAttributeFilter(0, currentTab.value, addFilterFilter.value);
        addFilterDialog.value = false;
        addFilterPosition.value = 1;
        addFilterFilter.value = null;
      }
    };
    const modifyFilter = (index: number, tab: 'track' | 'detection', filter: AttributeFilter['filterData']) => {
      const list = attributeFilters.value[tab];
      if (index < list.length) {
        const item: AttributeFilter = list[index];
        item.filterData = filter;
        modifyAttributeFilter(index, tab, item);
      }
    };

    const updateNewFilter = (filter: AttributeFilter['filterData']) => {
      if (addFilterFilter.value !== null) {
        addFilterFilter.value.filterData = filter;
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
      filterTypes,
      filterNames,
      selectedAddFilterType,
      // Adding Filter
      addFilterPosition,
      addFilterDialog,
      addFilterFilter,
      finalizeFilter,
      addFilter,
      updateNewFilter,
      /* methods */
      getComponentType,
      deleteFilter,
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
      <p>
        Add filters to decrease the number of attributes visible.
        Filter by attribute numeric value, top numeric values attribute name,
        attribute string value, or attribute boolean values.
        Filters are applied in the order they are created.
      </p>
      <v-card-title class="pa-0">
        <h4> Filter on: </h4>
      </v-card-title>
      <v-card-text>
        <div>
          <v-radio-group
            v-model="currentTab"
            row
          >
            <span
              v-for="item in tabMap"
              :key="item"
            >
              <v-radio
                :label="item"
                :value="item"
              />
            </span>
          </v-radio-group>
        </div>

        <div
          v-for="(filter, index) in attributeFilters[currentTab]"
          :key="`track_${index}`"
          no-gutters
        >
          <component
            :is="getComponentType(filter.dataType)"
            :attribute-filter="filter.filterData"
            :filter-names="filterNames"
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
          @click="addFilterDialog = true"
        >
          Add Filter
        </v-btn>
      </v-card-actions>
    </v-card>
    <v-dialog
      v-model="addFilterDialog"
      width="650"
    >
      <v-card>
        <v-card-title> Add Filter </v-card-title>
        <v-card-text>
          <v-stepper v-model="addFilterPosition">
            <v-stepper-header>
              <v-stepper-step
                :complete="addFilterPosition > 1"
                step="1"
              >
                Select Filter Type
              </v-stepper-step>

              <v-divider />

              <v-stepper-step
                :complete="addFilterPosition > 2"
                step="2"
              >
                Configure Filter
              </v-stepper-step>
            </v-stepper-header>
            <v-stepper-items>
              <v-stepper-content step="1">
                <p> Select the Attribute filter type to add </p>
                <v-container
                  class="px-0"
                  fluid
                >
                  <v-radio-group v-model="selectedAddFilterType">
                    <div
                      v-for="item in filterTypes"
                      :key="item.type"
                      class="pt-3"
                    >
                      <v-radio
                        :label="`${item.type}`"
                        :value="item.type"
                      />
                      <span> {{ item.description }} </span>
                    </div>
                  </v-radio-group>
                </v-container>
                <v-card-actions>
                  <v-spacer />
                  <v-btn
                    color="error"
                    class="mx-3"
                    @click="addFilterDialog = false; addFilterPosition = 1"
                  >
                    Cancel
                  </v-btn>
                  <v-btn
                    color="success"
                    @click="addFilter(selectedAddFilterType)"
                  >
                    Next
                  </v-btn>
                </v-card-actions>
              </v-stepper-content>
              <v-stepper-content step="2">
                <component
                  :is="`${getComponentType(addFilterFilter.dataType)}-settings`"
                  v-if="addFilterFilter !== null"
                  v-model="addFilterFilter.filterData"
                  :filter-names="filterNames"
                />
                <v-card-actions>
                  <v-spacer />
                  <v-btn
                    color="error"
                    class="mx-3"
                    @click="addFilterPosition = 1"
                  >
                    Cancel
                  </v-btn>
                  <v-btn
                    color="success"
                    @click="finalizeFilter"
                  >
                    Create
                  </v-btn>
                </v-card-actions>
              </v-stepper-content>
              <v-stepper-content step="3">
                Step 3 is completion
              </v-stepper-content>
            </v-stepper-items>
          </v-stepper>
        </v-card-text>
      </v-card>
    </v-dialog>
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
