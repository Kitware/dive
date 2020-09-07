<script lang="ts">
import Vue from 'vue';
import { PropType } from '@vue/composition-api';
import HeadTail, { HeadTailLineKey } from './headtail';

export default Vue.extend({
  props: {
    recipe: {
      type: Object as PropType<HeadTail>,
      required: true,
    },
  },

  computed: {
    active(): boolean {
      return this.recipe.active.value;
    },
  },

  methods: {
    activate() {
      this.$emit('set-annotation-state', { editing: 'LineString', key: HeadTailLineKey });
      this.recipe.activate();
    },
  },
});
</script>

<template>
  <v-btn @click="activate">
    <pre>1:</pre>
    <v-icon>mdi-fish</v-icon>
  </v-btn>
</template>
