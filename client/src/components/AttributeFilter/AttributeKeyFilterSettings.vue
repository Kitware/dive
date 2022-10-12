<script lang="ts">
import {
  defineComponent, PropType,
} from '@vue/composition-api';

import type { AttributeKeyFilter } from 'vue-media-annotator/use/useAttributes';
import TooltipBtn from '../TooltipButton.vue';

export default defineComponent({
  name: 'AttributeKeyFilterSettings',

  props: {
    value: {
      type: Object as PropType<AttributeKeyFilter>,
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
    <v-card-title> Key Filter Settings </v-card-title>
    <v-card-text>
      <v-row>
        <v-combobox
          v-model="value.appliedTo"
          :items="filterNames"
          chips
          labels="Apply To"
          multiple
          solor
          clearable
          hint="Select Attributes this filter displays"
          persistent-hint
          deletable-chips
        />
      </v-row>
    </v-card-text>
    <slot />
  </v-card>
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
