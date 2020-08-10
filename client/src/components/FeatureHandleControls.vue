<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';

export default Vue.extend({
  props: {
    selectedFeatureHandle: {
      type: Object as PropType<Ref<number>>,
      required: true,
    },
  },
});
</script>

<template>
  <v-btn
    v-if="selectedFeatureHandle.value >= 0"
    color="error"
    @click="$emit('delete-point')"
  >
    <v-icon>mdi-delete</v-icon>
    delete point {{ selectedFeatureHandle.value }}
  </v-btn>
</template>
