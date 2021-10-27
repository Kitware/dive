<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  props: {
    cameraName: String,
    showDelete: Boolean,
  },
});
</script>

<template>
  <v-card
    class="camera-group px-3 py-2"
    flat
    style="background-color: #2b2b2b;"
  >
    <v-row
      no-gutters
      class="align-center mb-2"
    >
      <h3>
        Camera {{ cameraName }}
      </h3>
      <v-btn
        v-if="showDelete"
        class="mx-3"
        icon
        small
        color="error"
        @click="$emit('delete')"
      >
        <v-icon>mdi-delete</v-icon>
      </v-btn>
    </v-row>
    <slot />
  </v-card>
</template>
