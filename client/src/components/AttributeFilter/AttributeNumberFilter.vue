<script lang="ts">
import {
  defineComponent, PropType, Ref, ref,
} from '@vue/composition-api';

import type { AttributeNumberFilter } from 'vue-media-annotator/use/useAttributes';
import { cloneDeep } from 'lodash';
import TooltipBtn from '../TooltipButton.vue';
import AttributeNumberFilterSettings from './AttributeNumberFilterSettings.vue';


export default defineComponent({
  name: 'AttributeNumberFilter',

  props: {
    attributeFilter: {
      type: Object as PropType<AttributeNumberFilter>,
      required: true,
    },
    filterNames: {
      type: Array as PropType<string[]>,
      required: true,
    },

  },

  components: { TooltipBtn, AttributeNumberFilterSettings },

  setup(props, { emit }) {
    const settingsDialog = ref(false);
    const copiedFilter: Ref<null | AttributeNumberFilter> = ref(null);
    // Ordering of these lists should match
    const setValue = (val: number) => {
      //update the filter value
      emit('update-value', val);
    };
    const setActive = (val: boolean) => {
      //update the filter value
      emit('update-active', val);
    };

    const showSettings = () => {
      copiedFilter.value = cloneDeep(props.attributeFilter);
      settingsDialog.value = true;
    };
    const saveChanges = () => {
      // Adjust value if out of range
      if (copiedFilter.value && copiedFilter.value.range) {
        const val = copiedFilter.value.value;
        const lowRange = copiedFilter.value.range[0];
        const highRange = copiedFilter.value.range[1];
        if (val < lowRange || val > highRange) {
          copiedFilter.value.value = lowRange;
        }
      }
      emit('save-changes', copiedFilter.value);
      settingsDialog.value = false;
    };

    return {
      settingsDialog,
      copiedFilter,
      /* methods */
      showSettings,
      saveChanges,
      setValue,
      setActive,
    };
  },
});
</script>

<template>
  <div>
    <v-row no-gutters>
      <h4>Number: {{ attributeFilter.type }}</h4>
      <v-spacer />
      <tooltip-btn
        icon="mdi-cog"
        size="x-small"
        tooltip-text="Edit Settings of Filter"
        @click="showSettings()"
      />
      <tooltip-btn
        icon="mdi-delete"
        color="error"
        size="x-small"
        tooltip-text="Delete Filter"
        @click="$emit('delete')"
      />
    </v-row>
    <v-divider />
    <div v-if="attributeFilter.type === 'range'">
      <v-row
        no-gutters
        class="align-center"
      >
        <v-checkbox
          :input-value="attributeFilter.active"
          label="enabled"
          @change="setActive"
        />
        <span class="pl-1"> {{ attributeFilter.appliedTo.join(',') }} </span>
        <b> {{ attributeFilter.comp }} </b>
        <span> value </span>
      </v-row>
      <v-row
        v-if="attributeFilter.range"
        no-gutters
        align-content="center"
      >
        <v-slider
          :value="attributeFilter.value"
          :min="attributeFilter.range[0]"
          :max="attributeFilter.range[1]"
          :step="attributeFilter.range[1] > 1 ? 1 : .01"
          :label="attributeFilter.value.toString()"
          @input="setValue"
        />
      </v-row>
    </div>
    <div v-else-if="attributeFilter.type === 'top'">
      <v-row no-gutters>
        <v-checkbox
          :value="attributeFilter.active"
          label="enabled"
          @change="setActive"
        />
        <span class="pl-1"> Show {{ attributeFilter.value }} top items </span>
      </v-row>
      <v-row
        no-gutters
        align-content="center"
      >
        <v-slider
          :value="attributeFilter.value"
          :min="attributeFilter.range[0]"
          :max="attributeFilter.range[1]"
          :step="1"
          :label="attributeFilter.value.toString()"
          @input="setValue"
        />
      </v-row>
    </div>
    <v-divider />
    <v-dialog
      v-model="settingsDialog"
      width="600"
    >
      <attribute-number-filter-settings
        v-if="settingsDialog && copiedFilter !== null"
        v-model="copiedFilter"
        :filter-names="filterNames"
      >
        <template>
          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed
              text
              @click="settingsDialog = false"
            >
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              @click="saveChanges"
            >
              Save
            </v-btn>
          </v-card-actions>
        </template>
      </attribute-number-filter-settings>
    </v-dialog>
  </div>
</template>

<style scoped lang='scss'>
</style>
