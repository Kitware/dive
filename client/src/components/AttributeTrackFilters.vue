<script lang="ts">
/* eslint-disable max-len */
import {
  computed, defineComponent, reactive, ref, Ref,
} from '@vue/composition-api';
import { AttributeTrackFilter, MatchOperator } from 'vue-media-annotator/AttributeTrackFilterControls';
import AttributeTrackFilterVue from '../../dive-common/components/AttributeTrackFilter.vue';
import { useAttributes, useTrackFilters, useTrackStyleManager } from '../provides';


export default defineComponent({
  name: 'AttributeTrackFilters',

  props: {
  },

  components: {
    AttributeTrackFilterVue,
  },

  setup() {
    const trackFilters = useTrackFilters();
    const typeStylingRef = useTrackStyleManager().typeStyling;
    const types = computed(() => trackFilters.allTypes.value);
    const attributes = useAttributes();
    const attributeTypes = computed(() => {
      const typeMap: Record<string, string> = {};
      attributes.value.forEach((item) => {
        typeMap[item.name] = item.datatype;
      });
      return typeMap;
    });


    const editingFilter: Ref<null | number> = ref(null);
    const addFilterDialog = ref(false);
    const filters = trackFilters.attributeFilters;

    interface EditingOptions {
      atrKey: string;
      name: string;
      atrOp: MatchOperator;
      atrVal: string[] | string | number | number[] | null | boolean;
      typeFilter: string[];
      range: number[];
      atrType: 'track' | 'detection';
      filterEnabled: boolean;
      userDefined: boolean;
      primaryDisplay: boolean;
    }
    const editing: EditingOptions = reactive({
      atrKey: '',
      name: '',
      atrOp: '=',
      atrVal: '',
      typeFilter: [],
      range: [0, 1],
      atrType: 'track',
      filterEnabled: true,
      userDefined: true,
      primaryDisplay: true,
    });
    const dropdowns = reactive({
      atrTypeList: ['track', 'detection'],
      ops: ['=', '≠', '>', '<', '>=', '<=', 'range', 'in', 'rangeFilter'],
    });

    const existingNames = computed(() => trackFilters.attributeFilters.value.map((item) => item.name));
    // editing/adding Attribute Filter
    const editingAttributeType = computed(() => {
      if (editing.atrKey) {
        const filtered = attributes.value.filter((item) => {
          if (editing.atrKey) {
            return item.name === editing.atrKey;
          }
          return false;
        });
        if (filtered.length > 0) {
          return filtered[0].datatype;
        }
      }
      return null;
    });

    const editingOps = computed(() => {
      if (editingAttributeType.value) {
        if (editingAttributeType.value === 'number') {
          return ['=', '≠', '>', '<', '>=', '<=', 'range', 'rangeFilter'];
        } if (editingAttributeType.value === 'text') {
          return ['=', '≠', 'in', 'contains'];
        }
        if (editingAttributeType.value === 'boolean') {
          return ['=', '≠'];
        }
      }
      return dropdowns.ops;
    });

    const attributeList = computed(() => attributes.value.filter((item) => item.belongs === editing.atrType).map((item) => item.name));

    const changeAttributeType = () => {
      if (editing.atrOp === 'range') {
        editing.atrVal = [0, 1];
      } else if (editing.atrOp === 'rangeFilter') {
        editing.atrVal = 0;
      } else {
        editing.atrVal = '';
      }
    };

    const addEditTrackFilter = (index?: number) => {
      if (index !== undefined) {
        const filter = filters.value[index];
        editing.atrKey = filter.attribute;
        editing.name = filter.name;
        editing.filterEnabled = filter.enabled;
        editing.atrType = filter.type;
        editing.atrOp = filter.filter.op;
        editing.atrVal = filter.filter.val;
        editing.typeFilter = filter.typeFilter;
        editing.userDefined = filter.filter.userDefined || false;
        editing.primaryDisplay = filter.primaryDisplay || false;
        if (filter.filter.range) {
          editing.range = filter.filter.range;
        }
        editingFilter.value = index;
      } else {
        editing.name = '';
        editing.atrKey = '';
        editing.atrOp = '=';
        editing.typeFilter = [];
        editingFilter.value = filters.value.length;
        editing.filterEnabled = true;
      }
      addFilterDialog.value = true;
    };

    const resetFilterFields = () => {
      editing.atrKey = '';
      editing.atrOp = '=';
      editing.atrVal = '';
      editing.typeFilter = [];
      editing.name = '';
      editing.filterEnabled = true;
      addFilterDialog.value = false;
      editing.userDefined = true;
      editing.primaryDisplay = true;
    };

    const saveFilter = () => {
      const updatedTrackFilter: AttributeTrackFilter = {
        typeFilter: editing.typeFilter,
        enabled: editing.filterEnabled,
        name: editing.name,
        attribute: editing.atrKey,
        type: editing.atrType,
        primaryDisplay: editing.primaryDisplay,
        filter: {
          op: editing.atrOp,
          val: editing.atrVal,
          userDefined: editing.userDefined,
        },
      };
      if (editing.atrOp === 'rangeFilter') {
        updatedTrackFilter.filter.range = editing.range;
      }
      if (editingFilter.value !== null) {
        trackFilters.updateTrackFilter(editingFilter.value, updatedTrackFilter);
      }
      addFilterDialog.value = false;
      editing.atrKey = '';
      editing.typeFilter = [];
      editing.atrOp = '=';
      editing.atrVal = '';
      editing.name = '';
    };
    const deleteFilter = (index: number) => {
      trackFilters.deleteTrackFilter(index);
    };
    const areSettingsValid = ref(false);

    const deleteChip = (item: string) => {
      editing.typeFilter.splice(editing.typeFilter.findIndex((data) => data === item));
    };

    return {
      trackFilters,
      filters,
      editingFilter,
      attributeTypes,
      types,
      //defaults
      dropdowns,
      // editing
      editing,
      editingOps, //computed comparison operators
      editingAttributeType, // computed Attribute Type
      addFilterDialog,
      attributeList,
      areSettingsValid,
      existingNames,
      changeAttributeType,
      resetFilterFields,
      deleteFilter,
      saveFilter,
      addEditTrackFilter,
      typeStylingRef,
      deleteChip,
    };
  },
});
</script>

<template>
  <div>
    <v-card class="pa-0">
      <p>
        Add Track Attribute filters to filter out tracks.
      </p>
      <v-card-title class="pa-0" />
      <v-card-text>
        <attribute-track-filter-vue
          v-for="(item, index) in filters"
          :key="item.name"
          :filter-index="index"
          editable
          class="attributeTrackFilter ma-2"
          @edit="addEditTrackFilter(index)"
          @delete="deleteFilter(index)"
        />
      </v-card-text>
      <v-card-actions>
        <v-btn
          color="success"
          tooltip-text="Add Filter"
          @click="addEditTrackFilter()"
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
        <v-card-title> Add/Edit Track Attribute Filter </v-card-title>
        <v-card-text>
          <v-form
            ref="form"
            v-model="areSettingsValid"
          >
            <v-row dense>
              <v-text-field
                v-model="editing.name"
                label="Filter Name"
                :rules="[v => !!v || 'Name is required', (v) => (!existingNames.includes(v) || editingFilter !== filters.length) || 'Name needs to be unique']"
                required
              />
            </v-row>
            <v-row dense>
              <v-select
                v-model="editing.typeFilter"
                :items="types"
                multiple
                clearable
                deletable-chips
                chips
                label="Track Types"
              >
                <template #selection="{ item }">
                  <v-chip
                    close
                    :color="typeStylingRef.color(item)"
                    text-color="#555555"
                    @click:close="deleteChip(item)"
                  >
                    {{ item }}
                  </v-chip>
                </template>
              </v-select>
              <v-tooltip
                open-delay="100"
                bottom
              >
                <template #activator="{ on }">
                  <v-icon v-on="on">
                    mdi-information
                  </v-icon>
                </template>
                <span
                  class="ma-0 pa-1"
                >
                  Empty is all Tracks, or select a specific track type to filter
                </span>
              </v-tooltip>
            </v-row>
            <v-row dense>
              <v-select
                v-model="editing.atrType"
                :items="dropdowns.atrTypeList"
                label="Attribute Type"
                class="mx-2"
              />

              <v-select
                v-model="editing.atrKey"
                :rules="[v => !!v || 'Attribute is required']"
                required
                :items="attributeList"
                label="Attribute"
                class="mx-2"
              />
            </v-row>
            <v-row dense>
              <v-switch
                v-model="editing.filterEnabled"
                label="Enabled"
                class="mx-2"
              />
              <v-tooltip
                open-delay="100"
                bottom
              >
                <template #activator="{ on }">
                  <v-icon v-on="on">
                    mdi-information
                  </v-icon>
                </template>
                <span
                  class="ma-0 pa-1"
                >
                  Will configure the filter to be enabled when opening the dataset.
                </span>
              </v-tooltip>

              <v-switch
                v-model="editing.primaryDisplay"
                label="Primary Display"
                class="mx-2"
              />
              <v-tooltip
                open-delay="100"
                bottom
              >
                <template #activator="{ on }">
                  <v-icon v-on="on">
                    mdi-information
                  </v-icon>
                </template>
                <span
                  class="ma-0 pa-1"
                >
                  The Track Attribute Filter will be displayed on the main panel below the type list.
                </span>
              </v-tooltip>

              <v-switch
                v-model="editing.userDefined"
                label="User Editable"
                class="mx-2"
              />
              <v-tooltip
                open-delay="100"
                bottom
              >
                <template #activator="{ on }">
                  <v-icon v-on="on">
                    mdi-information
                  </v-icon>
                </template>
                <span
                  class="ma-0 pa-1"
                >
                  The values for the filter can be edited by the user.
                </span>
              </v-tooltip>
            </v-row>
            <v-row dense>
              <v-select
                v-model="editing.atrOp"
                :items="editingOps"
                label="Operator"
                :rules="[v => !!v || 'Operator is required']"
                required
                @change="changeAttributeType"
              />
            </v-row>
            <v-row dense>
              <v-text-field
                v-if="!['range', 'in'].includes(editing.atrOp)"
                v-model="editing.atrVal"
                :type="attributeTypes[editing.atrKey] === 'text' ? 'text' : 'number'"
                :label="editing.atrOp === 'rangeFilter' ? 'Default Value' : 'Test/Default Value'"
                step="0.01"
                persistent-hint
                :hint="editing.atrOp === 'rangeFilter' ? 'Default Value' : 'Test/Default Value'"
              />
              <div
                v-else-if="'in' === editing.atrOp"
              >
                <v-combobox
                  v-model="editing.atrVal"
                  chips
                  dense
                  deletable-chips
                  multiple
                  :type="attributeTypes[editing.atrKey] === 'text' ? 'text' : 'number'"
                />
              </div>
              <div
                v-else-if="'range' === editing.atrOp && editing.atrVal !== null && typeof editing.atrVal === 'object' && editing.atrVal.length > 0"
              >
                <v-text-field
                  v-model="editing.atrVal[0]"
                  :type="'number'"
                  label="low"
                />
                <v-text-field
                  v-model="editing.atrVal[1]"
                  :type="'number'"
                  label="high"
                />
              </div>
              <v-row
                v-if="'rangeFilter' === editing.atrOp"
                dense
              >
                <v-text-field
                  v-model="editing.range[0]"
                  :type="'number'"
                  label="low range"
                />
                <v-text-field
                  v-model="editing.range[1]"
                  :type="'number'"
                  label="high range"
                />
              </v-row>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-row>
            <v-spacer />
            <v-btn @click="resetFilterFields">
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              :disabled="!areSettingsValid"
              @click="saveFilter"
            >
              Save
            </v-btn>
          </v-row>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped lang='scss'>
@import 'src/components/styles/common.scss';

 .attributeTrackFilter {
  border: 1px solid gray;
  padding: 5px;
 }

.type-checkbox {
  max-width: 80%;
  overflow-wrap: anywhere;
}
</style>
