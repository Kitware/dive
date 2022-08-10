<script lang="ts">
import {
  defineComponent, PropType,
} from '@vue/composition-api';

import type { AttributeStringFilter } from 'vue-media-annotator/use/useAttributes';
import TooltipBtn from '../TooltipButton.vue';

export default defineComponent({
  name: 'AttributeStringFilterSettings',

  props: {
    value: {
      type: Object as PropType<AttributeStringFilter>,
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
    return {
      /* methods */
      updateField,
    };
  },
});
</script>

<template>
  <v-card>
    <v-card-title> Number Filter Settings </v-card-title>
    <v-card-text>
      <v-row>
        <v-combobox
          v-model="value.appliedTo"
          :items="filterNames"
          chips
          labels="Apply To"
          multiple
          outlined
          hint="Select Attributes this filter applies to"
          persistent-hint
          deletable-chips
          clearable
        />
      </v-row>
      <div>
        <v-row>
          <v-select
            v-model="value.comp"
            :items="['=', '!=', 'contains', 'starts']"
            label="Comparison"
            outlined
          />
        </v-row>
        <v-row>
          <v-combobox
            v-model="value.value"
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
    <slot />
  </v-card>
</template>

<style scoped lang='scss'>
</style>
