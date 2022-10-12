<script lang="ts">
import {
  defineComponent, PropType,
} from '@vue/composition-api';

import type { AttributeNumberFilter } from 'vue-media-annotator/use/useAttributes';
import TooltipBtn from '../TooltipButton.vue';


export default defineComponent({
  name: 'AttributeNumberFilterSettings',

  props: {
    value: {
      type: Object as PropType<AttributeNumberFilter>,
      required: true,
    },
    filterNames: {
      type: Array as PropType<string[]>,
      required: true,
    },
  },

  components: { TooltipBtn },

  setup(props, { emit }) {
    const updateField = (key: string, val: number | string) => {
      emit('input', { ...props.value, [key]: val });
    };
    const typeChange = () => {
      if (props.value) {
        if (props.value.type === 'top') {
          emit('input', { ...props.value, value: 10, range: [1, 50] });
        }
      }
    };
    return {
      /* methods */
      updateField,
      typeChange,
    };
  },
});
</script>

<template>
  <v-card>
    <v-card-title> Number Filter Settings </v-card-title>
    <v-card-text>
      <v-row no-gutters>
        <ul>
          <li>
            "range" - to set a slider range that can be
            filtered based on the comparison value
          </li>
          <li> "top" - filter to show the top X numerical values </li>
        </ul>

        <v-select
          v-model="value.type"
          :items="['range', 'top']"
          label="Type"
          outlined
          @change="typeChange"
        />
      </v-row>
      <v-row>
        <v-combobox
          v-model="value.appliedTo"
          :items="filterNames"
          chips
          labels="Apply To"
          multiple
          hint="Select Attributes this filter applies to"
          persistent-hint
          outlined
          deletable-chips
          class="mb-2"
        />
      </v-row>
      <div v-if="value.type === 'range'">
        <v-row class="pb-3">
          <v-select
            v-model="value.comp"
            :items="['>', '<', '>=', '<=']"
            label="Comparison"
            :hint="`Show values that are ${value.comp} the filter value`"
            persistent-hint
            outlined
          />
        </v-row>
        <v-row class="pt-2">
          <v-text-field
            v-model.number="value.range[0]"
            hide-details
            dense
            outlined
            :step="value.range[0]> 1 ? 1 : 0.01"
            type="number"
            label="Lower"
            :max="value.range[1]"
            hint="Lower limit for slider"
            persistent-hint
          />
          <v-text-field
            v-model.number="value.range[1]"
            dense
            outlined
            :step="value.range[1]> 1 ? 1 : 0.01"
            type="number"
            label="Upper"
            :min="value.range[0]"
            hint="Upper limit for slider"
            persistent-hint
          />
        </v-row>
      </div>
      <div v-else-if="value.type === 'top'">
        <v-text-field
          v-model.number="value.value"
          outlined
          dense
          :step="1"
          type="number"
          label="Top X items"
          :min="1"
          persistent-hint
        />
      </div>
    </v-card-text>
    <slot />
  </v-card>
</template>

<style scoped lang='scss'>
</style>
