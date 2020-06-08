<script lang="ts">
import { PropType, Ref } from '@vue/composition-api';
import Vue from 'vue';

export default Vue.extend({
  name: 'TypeList',

  props: {
    checkedTypes: {
      type: Object as PropType<Ref<string[]>>,
      required: true,
    },
    allTypes: {
      type: Object as PropType<Ref<string[]>>,
      required: true,
    },
    typeColorMapper: {
      type: Function as PropType<(t: string) => string>,
      required: true,
    },
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-subheader class="flex-shrink-0">
      Type Filter
    </v-subheader>
    <div class="overflow-y-auto flex-grow-1">
      <v-checkbox
        v-for="type in allTypes.value"
        :key="type"
        v-model="checkedTypes.value"
        :value="type"
        :color="typeColorMapper(type)"
        :label="type"
        dense
        hide-details
        class="my-1 ml-3"
      />
    </div>
  </div>
</template>
