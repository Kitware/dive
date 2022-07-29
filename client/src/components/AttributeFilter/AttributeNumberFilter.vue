<script lang="ts">
import {
  computed,
  defineComponent, PropType, Ref, ref,
} from '@vue/composition-api';

import type { AttributeNumberFilter } from 'vue-media-annotator/use/useAttributes';
import { cloneDeep } from 'lodash';
import { useAttributes } from 'vue-media-annotator/provides';
import TooltipBtn from '../TooltipButton.vue';


export default defineComponent({
  name: 'AttributeNumberFilter',

  props: {
    attributeFilter: {
      type: Object as PropType<AttributeNumberFilter>,
      required: true,
    },
  },

  components: { TooltipBtn },

  setup(props, { emit }) {
    const settingsDialog = ref(false);
    const attributesList = useAttributes();
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

    const typeChange = () => {
      if (copiedFilter.value) {
        if (copiedFilter.value.type === 'top') {
          if (copiedFilter.value.value < 1) {
            copiedFilter.value.value = 10;
          }
          copiedFilter.value.range = [1, 50];
        }
      }
    };

    const filterNames = computed(() => {
      const data = ['all'];
      return data.concat(attributesList.value.filter(
        (item) => item.datatype === 'number',
      ).map((item) => item.name));
    });
    const removeChip = (item: string) => {
      if (copiedFilter.value) {
        copiedFilter.value.appliedTo.splice(copiedFilter.value.appliedTo.indexOf(item), 1);
      }
    };

    return {
      settingsDialog,
      copiedFilter,
      filterNames,
      /* methods */
      showSettings,
      saveChanges,
      setValue,
      setActive,
      typeChange,
      removeChip,
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
      <v-card v-if="settingsDialog && copiedFilter !== null">
        <v-card-title> Number Filter Settings </v-card-title>
        <v-card-text>
          <v-row no-gutters>
            <v-select
              v-model="copiedFilter.type"
              :items="['range', 'top']"
              label="Type"
              @change="typeChange"
            />
          </v-row>
          <v-row>
            <v-combobox
              v-model="copiedFilter.appliedTo"
              :items="filterNames"
              chips
              labels="Apply To"
              multiple
              solor
            >
              <template v-slot:selection="{ attrs, item, select, selected }">
                <v-chip
                  v-bind="attrs"
                  :input-value="selected"
                  close
                  @click="select"
                  @click:close="removeChip(item)"
                >
                  <strong>{{ item }}</strong>&nbsp;
                </v-chip>
              </template>
            </v-combobox>
          </v-row>
          <div v-if="copiedFilter.type === 'range'">
            <v-row>
              <v-select
                v-model="copiedFilter.comp"
                :items="['>', '<', '>=', '<=']"
                label="Comparison"
              />
            </v-row>
            <v-row>
              <v-text-field
                v-model.number="copiedFilter.range[0]"
                hide-details
                dense
                :step="copiedFilter.range[0]> 1 ? 1 : 0.01"
                type="number"
                label="Lower"
                :max="copiedFilter.range[1]"
              />
              <v-text-field
                v-model.number="copiedFilter.range[1]"
                hide-details
                dense
                :step="copiedFilter.range[1]> 1 ? 1 : 0.01"
                type="number"
                label="Upper"
                :min="copiedFilter.range[0]"
              />
            </v-row>
          </div>
          <div v-else-if="copiedFilter.type === 'top'">
            <v-text-field
              v-model.number="copiedFilter.value"
              hide-details
              single-line
              dense
              :step="1"
              type="number"
              label="Top X items"
              :min="1"
            />
          </div>
        </v-card-text>
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
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped lang='scss'>
</style>
