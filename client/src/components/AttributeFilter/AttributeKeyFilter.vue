<script lang="ts">
import {
  defineComponent, PropType, Ref, ref,
} from '@vue/composition-api';

import type { AttributeKeyFilter } from 'vue-media-annotator/use/useAttributes';
import { cloneDeep } from 'lodash';
import { useAttributes } from 'vue-media-annotator/provides';
import TooltipBtn from '../TooltipButton.vue';
import AttributeKeyFilterSettings from './AttributeKeyFilterSettings.vue';

export default defineComponent({
  name: 'AttributeKeyFilter',

  props: {
    attributeFilter: {
      type: Object as PropType<AttributeKeyFilter>,
      required: true,
    },
    filterNames: {
      type: Array as PropType<string[]>,
      required: true,
    },
    timeline: {
      type: Boolean,
      default: false,
    },
  },

  components: { TooltipBtn, AttributeKeyFilterSettings },

  setup(props, { emit }) {
    const settingsDialog = ref(false);
    const attributesList = useAttributes();
    const copiedFilter: Ref<null | AttributeKeyFilter> = ref(null);
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

    const getColor = (item: string) => {
      const found = attributesList.value.find((atr) => atr.key === item || atr.key === `detection_${item}`);
      return found?.color || 'white';
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
      getColor,
    };
  },
});
</script>

<template>
  <div>
    <v-row no-gutters>
      <h4>{{ !timeline ? 'Key' : 'Timeline' }} Filter</h4>
      <v-spacer />
      <tooltip-btn
        icon="mdi-cog"
        size="x-small"
        tooltip-text="Edit Settings of Filter"
        @click="showSettings()"
      />
      <tooltip-btn
        v-if="!timeline"
        icon="mdi-delete"
        color="error"
        size="x-small"
        tooltip-text="Delete Filter"
        @click="$emit('delete')"
      />
    </v-row>
    <v-divider />
    <div v-if="!timeline">
      <v-row
        no-gutters
        class="align-center"
      >
        <v-checkbox
          :input-value="attributeFilter.active"
          label="enabled"
          :disabled="timeline"
          @change="setActive"
        />
        <span class="pl-1"> {{ attributeFilter.appliedTo.join(',') }} </span>
      </v-row>
    </div>
    <div v-else-if="timeline">
      <v-row
        v-for="item in attributeFilter.appliedTo"
        :key="item"
      >
        <div
          class="type-color-box"
          :style="{
            backgroundColor: getColor(item),
          }"
        /><span>{{ item }}</span>
      </v-row>
    </div>
    <v-divider />
    <v-dialog
      v-model="settingsDialog"
      width="600"
    >
      <attribute-key-filter-settings
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
      </attribute-key-filter-settings>
    </v-dialog>
  </div>
</template>

<style scoped lang='scss'>
  .type-color-box {
    margin: 7px;
    margin-top: 4px;
    min-width: 15px;
    max-width: 15px;
    min-height: 15px;
    max-height: 15px;
  }
</style>
