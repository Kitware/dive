<script lang="ts">
/* eslint-disable max-len */
import {
  computed, defineComponent, ref, Ref,
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

    const existingNames = computed(() => trackFilters.attributeFilters.value.map((item) => item.name));
    // editing/adding Attribute Filter
    const editingAtrKey = ref('');
    const editName = ref('');
    const baseOps = ['=', '!=', '>', '<', '>=', '<=', 'range', 'in', 'rangeFilter'];
    const editingAttributeType = computed(() => {
      if (editingAtrKey.value) {
        const filtered = attributes.value.filter((item) => {
          if (editingAtrKey.value) {
            return item.name === editingAtrKey.value;
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
          return ['=', '!=', '>', '<', '>=', '<=', 'range', 'rangeFilter'];
        } if (editingAttributeType.value === 'text') {
          return ['=', '!=', 'in', 'contains'];
        }
        if (editingAttributeType.value === 'boolean') {
          return ['=', '!='];
        }
      }
      return baseOps;
    });


    const editingAtrOp: Ref<MatchOperator> = ref('=');
    const editingAtrVal: Ref<string[] | string | number | number[] | null | boolean> = ref('');
    const editingTypeFilter: Ref<string[]> = ref([]);
    const editingRange: Ref<number[]> = ref([0, 1]);
    const editingAtrTypeList = ref(['track', 'detection']);
    const editingFilterEnabled = ref(true);
    const editingAtrType: Ref<'track' | 'detection'> = ref('track');
    const editingUserDefined = ref(true);
    const editingPrimaryDisplay = ref(true);
    const attributeList = computed(() => attributes.value.filter((item) => item.belongs === editingAtrType.value).map((item) => item.name));

    const changeAttributeType = () => {
      if (editingAtrOp.value === 'range') {
        editingAtrVal.value = [0, 1];
      } else if (editingAtrOp.value === 'rangeFilter') {
        editingAtrVal.value = 0;
      } else {
        editingAtrVal.value = '';
      }
    };

    const addEditTrackFilter = (index?: number) => {
      if (index !== undefined) {
        const filter = filters.value[index];
        editingAtrKey.value = filter.attribute;
        editName.value = filter.name;
        editingFilterEnabled.value = filter.enabled;
        editingAtrType.value = filter.type;
        editingAtrOp.value = filter.filter.op;
        editingAtrVal.value = filter.filter.val;
        editingTypeFilter.value = filter.typeFilter;
        editingUserDefined.value = filter.filter.userDefined || false;
        editingPrimaryDisplay.value = filter.primaryDisplay || false;
        if (filter.filter.range) {
          editingRange.value = filter.filter.range;
        }
        editingFilter.value = index;
      } else {
        editName.value = '';
        editingAtrKey.value = '';
        editingAtrOp.value = '=';
        editingTypeFilter.value = [];
        editingFilter.value = filters.value.length;
        editingFilterEnabled.value = true;
      }
      addFilterDialog.value = true;
    };

    const cancelFilter = () => {
      editingAtrKey.value = '';
      editingAtrOp.value = '=';
      editingAtrVal.value = '';
      editingTypeFilter.value = [];
      editName.value = '';
      editingFilterEnabled.value = true;
      addFilterDialog.value = false;
      editingUserDefined.value = true;
      editingPrimaryDisplay.value = true;
    };

    const saveFilter = () => {
      const updatedTrackFilter: AttributeTrackFilter = {
        typeFilter: editingTypeFilter.value,
        enabled: editingFilterEnabled.value,
        name: editName.value,
        attribute: editingAtrKey.value,
        type: editingAtrType.value,
        primaryDisplay: editingPrimaryDisplay.value,
        filter: {
          op: editingAtrOp.value,
          val: editingAtrVal.value,
          userDefined: editingUserDefined.value,
        },
      };
      if (editingAtrOp.value === 'rangeFilter') {
        updatedTrackFilter.filter.range = editingRange.value;
      }
      if (editingFilter.value !== null) {
        trackFilters.updateTrackFilter(editingFilter.value, updatedTrackFilter);
      }
      addFilterDialog.value = false;
      editingAtrKey.value = '';
      editingTypeFilter.value = [];
      editingAtrOp.value = '=';
      editingAtrVal.value = '';
      editName.value = '';
    };
    const deleteFilter = (index: number) => {
      trackFilters.deleteTrackFilter(index);
    };
    const areSettingsValid = ref(false);

    const deleteChip = (item: string) => {
      editingTypeFilter.value.splice(editingTypeFilter.value.findIndex((data) => data === item));
    };

    return {
      trackFilters,
      filters,
      editingFilter,
      attributeTypes,
      types,
      // editing
      addFilterDialog,
      editName,
      editingAtrKey,
      editingOps,
      editingAtrOp,
      editingAtrVal,
      editingAtrType,
      editingAtrTypeList,
      editingFilterEnabled,
      editingPrimaryDisplay,
      editingAttributeType,
      editingTypeFilter,
      editingUserDefined,
      attributeList,
      editingRange,
      areSettingsValid,
      existingNames,
      changeAttributeType,
      cancelFilter,
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
                v-model="editName"
                label="Filter Name"
                :rules="[v => !!v || 'Name is required', (v) => (!existingNames.includes(v) || editingFilter !== filters.length) || 'Name needs to be unique']"
                required
              />
            </v-row>
            <v-row dense>
              <v-select
                v-model="editingTypeFilter"
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
                v-model="editingAtrType"
                :items="editingAtrTypeList"
                label="Attribute Type"
                class="mx-2"
              />

              <v-select
                v-model="editingAtrKey"
                :rules="[v => !!v || 'Attribute is required']"
                required
                :items="attributeList"
                label="Attribute"
                class="mx-2"
              />
            </v-row>
            <v-row dense>
              <v-switch
                v-model="editingFilterEnabled"
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
                v-model="editingPrimaryDisplay"
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
                v-model="editingUserDefined"
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
                v-model="editingAtrOp"
                :items="editingOps"
                label="Operator"
                :rules="[v => !!v || 'Operator is required']"
                required
                @change="changeAttributeType"
              />
            </v-row>
            <v-row dense>
              <v-text-field
                v-if="!['range', 'in'].includes(editingAtrOp)"
                v-model="editingAtrVal"
                :type="attributeTypes[editingAtrKey] === 'text' ? 'text' : 'number'"
                :label="editingAtrOp === 'rangeFilter' ? 'Default Value' : 'Test/Default Value'"
                persistent-hint
                :hint="editingAtrOp === 'rangeFilter' ? 'Default Value' : 'Test/Default Value'"
              />
              <div
                v-else-if="'in' === editingAtrOp"
              >
                <v-combobox
                  v-model="editingAtrVal"
                  chips
                  dense
                  deletable-chips
                  multiple
                  :type="attributeTypes[editingAtrKey] === 'text' ? 'text' : 'number'"
                />
              </div>
              <div
                v-else-if="'range' === editingAtrOp && editingAtrVal !== null && typeof editingAtrVal === 'object' && editingAtrVal.length > 0"
              >
                <v-text-field
                  v-model="editingAtrVal[0]"
                  :type="'number'"
                  label="low"
                />
                <v-text-field
                  v-model="editingAtrVal[1]"
                  :type="'number'"
                  label="high"
                />
              </div>
              <v-row
                v-if="'rangeFilter' === editingAtrOp"
                dense
              >
                <v-text-field
                  v-model="editingRange[0]"
                  :type="'number'"
                  label="low range"
                />
                <v-text-field
                  v-model="editingRange[1]"
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
            <v-btn @click="cancelFilter">
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
