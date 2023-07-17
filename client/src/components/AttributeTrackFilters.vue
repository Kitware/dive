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
    const attributes = useAttributes();
    const typeStylingRef = useTrackStyleManager().typeStyling;
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

    // editing/adding Attribute Filter
    const editingAtrKey = ref('');
    const editName = ref('');
    const editingOps = ref(['=', '!=', '>', '<', '>=', '<=', 'range', 'in', 'rangeFilter']);
    const editingAtrOp: Ref<MatchOperator> = ref('=');
    const editingAtrVal: Ref<string[] | string | number | number[] | null | boolean> = ref('');
    const editingRange: Ref<number[]> = ref([0, 1]);
    const editingAtrTypeList = ref(['track', 'detection']);
    const editingFilterEnabled = ref(false);
    const editingFilterDisplay = ref(false);
    const editingAtrType: Ref<'track' | 'detection'> = ref('track');
    const editingUserDefined = ref(true);
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
        const filter = filters.value[0];
        editingAtrKey.value = filter.attribute;
        editName.value = filter.name;
        editingFilterEnabled.value = filter.enabled;
        editingAtrType.value = filter.type;
        editingAtrOp.value = filter.filter.op;
        editingAtrVal.value = filter.filter.val;
        editingUserDefined.value = filter.filter.userDefined || false;
        if (filter.filter.range) {
          editingRange.value = filter.filter.range;
        }
        editingFilter.value = index;
      } else {
        editingFilter.value = filters.value.length;
      }
      addFilterDialog.value = true;
    };

    const cancelFilter = () => {
      editingAtrKey.value = '';
      editingAtrOp.value = '=';
      editingAtrVal.value = '';
      addFilterDialog.value = false;
    };

    const saveFilter = () => {
      const updatedTrackFilter: AttributeTrackFilter = {
        typeFilter: [],
        enabled: editingFilterEnabled.value,
        name: editName.value,
        attribute: editingAtrKey.value,
        type: editingAtrType.value,
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
    };
    const deleteFilter = (index: number) => {
      trackFilters.deleteTrackFilter(index);
    };

    return {
      trackFilters,
      filters,
      editingFilter,
      attributeTypes,
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
      editingFilterDisplay,
      attributeList,
      editingRange,
      changeAttributeType,
      cancelFilter,
      deleteFilter,
      saveFilter,
      addEditTrackFilter,
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
          <v-text-field
            v-model="editName"
            label="Filter Name"
          />
          <v-row dense>
            <v-select
              v-model="editingAtrKey"
              :items="attributeList"
              label="Attribute"
            />
          </v-row>
          <v-row dense>
            <v-select
              v-model="editingAtrOp"
              :items="editingOps"
              label="Operator"
              @change="changeAttributeType"
            />
          </v-row>
          <v-row dense>
            <v-text-field
              v-if="!['range', 'in'].includes(editingAtrOp)"
              v-model="editingAtrVal"
              :type="attributeTypes[editingAtrKey] === 'text' ? 'text' : 'number'"
              :label="editingAtrOp === 'rangeFilter' ? 'Default Value' : 'Test Value'"
              persistent-hint
              :hint="editingAtrOp === 'rangeFilter' ? 'Default Value' : 'Test Value'"
            />
            <div
              v-else-if="'in' === editingAtrOp"
            >
              <v-combobox
                v-model="editingAtrVal"
                chips
                deletable-chips
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
        </v-card-text>
        <v-card-actions>
          <v-row>
            <v-spacer />
            <v-btn @click="cancelFilter">
              Cancel
            </v-btn>
            <v-btn
              color="primary"
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
