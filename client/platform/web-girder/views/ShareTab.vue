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
    :value="value"
    right
    @change="$emit('input', $event)"
  >
    <v-tab>
      Browse Data
    </v-tab>
    <v-tab>
      Shared with Me
    </v-tab>
  </v-tabs>
</template>
