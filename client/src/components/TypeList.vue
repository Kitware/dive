<script lang="ts">
// TODO p2
// eslint-disable-next-line no-unused-vars
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
  <div class="typelist d-flex flex-column">
    <v-subheader>Types</v-subheader>
    <div
      class="flex-grow-1"
      style="overflow-y: auto;"
    >
      <div>
        <v-checkbox
          v-for="type in allTypes.value"
          :key="type"
          v-model="checkedTypes.value"
          :value="type"
          :color="typeColorMapper(type)"
          :label="type"
          dense
          hide-details
          class="my-2 ml-3"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.typelist {
  overflow-y: auto;
}
</style>
