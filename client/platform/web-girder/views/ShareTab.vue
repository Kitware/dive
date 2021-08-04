<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  name: 'ShareTab',
  props: {
    value: {
      type: Number,
      required: true,
    },
  },
});
</script>

<template>
  <v-tabs
    right
    @change="$emit('input', $event)"
  >
    <v-tab :to="{name: 'home'}">
      Browse Data
    </v-tab>
    <v-tab :to="{name: 'shared'}">
      Shared with Me
    </v-tab>
  </v-tabs>
</template>
