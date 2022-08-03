<script lang="ts">
import {
  computed,
  defineComponent, PropType, Ref, ref,
} from '@vue/composition-api';

import type { AttributeStringFilter } from 'vue-media-annotator/use/useAttributes';
import { cloneDeep } from 'lodash';
import { useAttributes } from 'vue-media-annotator/provides';
import TooltipBtn from '../TooltipButton.vue';

export default defineComponent({
  name: 'AttributeStringFilter',

  props: {
    attributeFilter: {
      type: Object as PropType<AttributeStringFilter>,
      required: true,
    },
  },

  components: { TooltipBtn },

  setup(props, { emit }) {
    const settingsDialog = ref(false);
    const attributesList = useAttributes();
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
      <v-card v-if="settingsDialog && copiedFilter !== null">
        <v-card-title> Number Filter Settings </v-card-title>
        <v-card-text>
          <v-row>
            <v-combobox
              v-model="copiedFilter.appliedTo"
              :items="filterNames"
              chips
              labels="Apply To"
              multiple
              outlined
              hint="Select Attributes this filter applies to"
              persistent-hint
              clearable
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
          <div>
            <v-row>
              <v-select
                v-model="copiedFilter.comp"
                :items="['=', '!=', 'contains', 'starts']"
                label="Comparison"
                outlined
              />
            </v-row>
            <v-row>
              <v-combobox
                v-model="copiedFilter.value"
                chips
                labels="Values"
                multiple
                solor
                deletable-chips
                hint="List of  the filter will match"
                persistent-hint
                clearable
              />
            </v-row>
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
