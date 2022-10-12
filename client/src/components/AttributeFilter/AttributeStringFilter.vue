<script lang="ts">
import {
  defineComponent, PropType, Ref, ref,
} from '@vue/composition-api';

import type { AttributeStringFilter } from 'vue-media-annotator/use/useAttributes';
import { cloneDeep } from 'lodash';
import TooltipBtn from '../TooltipButton.vue';
import AttributeStringFilterSettings from './AttributeStringFilterSettings.vue';

export default defineComponent({
  name: 'AttributeStringFilter',

  props: {
    attributeFilter: {
      type: Object as PropType<AttributeStringFilter>,
      required: true,
    },
    filterNames: {
      type: Array as PropType<string[]>,
      required: true,
    },

  },

  components: { TooltipBtn, AttributeStringFilterSettings },

  setup(props, { emit }) {
    const settingsDialog = ref(false);
    const copiedFilter: Ref<null | AttributeStringFilter> = ref(null);
    // Ordering of these lists should match
    const setValue = (val: string) => {
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
      emit('save-changes', copiedFilter.value);
      settingsDialog.value = false;
    };

    const removeChip = (item: string) => {
      if (copiedFilter.value) {
        copiedFilter.value.appliedTo.splice(copiedFilter.value.appliedTo.indexOf(item), 1);
      }
    };

    return {
      settingsDialog,
      copiedFilter,
      /* methods */
      showSettings,
      saveChanges,
      setValue,
      setActive,
      removeChip,
    };
  },
});
</script>

<template>
  <div>
    <v-row no-gutters>
      <h4>String: {{ attributeFilter.comp }}</h4>
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
    <div>
      <v-row
        no-gutters
        class="align-center"
      >
        <v-checkbox
          :value="attributeFilter.active"
          label="enabled"
          @change="setActive"
        />
        <span class="pl-1"> {{ attributeFilter.appliedTo.join(',') }} </span>
        <b class="px-2"> {{ attributeFilter.comp }} </b>
        <span> {{ attributeFilter.value.join(',') }} </span>
      </v-row>
    </div>
    <v-divider />
    <v-dialog
      v-model="settingsDialog"
      width="600"
    >
      <attribute-string-filter-settings
        v-if="settingsDialog && copiedFilter !== null"
        v-model="copiedFilter"
        :filter-names="filterNames"
      >
        <v-card-title> Number Filter Settings </v-card-title>
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
      </attribute-string-filter-settings>
    </v-dialog>
  </div>
</template>

<style scoped lang='scss'>
</style>
