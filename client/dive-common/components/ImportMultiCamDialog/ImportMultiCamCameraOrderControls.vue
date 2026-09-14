<!--
  Up/down reorder buttons. Requires `ctx`; uses ctx.canMoveCamera and ctx.moveCamera.
  Parent panel must pass :ctx="ctx" (see README.md § Shared context (`ctx`)).
-->
<script lang="ts">
import { defineComponent } from 'vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamCameraOrderControls',
  props: {
    ...importMultiCamContextProp,
    cameraKey: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { canMoveCamera, moveCamera } = props.ctx;
    return { canMoveCamera, moveCamera };
  },
});
</script>

<template>
  <v-row
    no-gutters
    class="align-center mb-2"
  >
    <v-btn
      icon
      small
      :disabled="!canMoveCamera(cameraKey, -1)"
      @click="moveCamera(cameraKey, -1)"
    >
      <v-icon>mdi-arrow-up</v-icon>
    </v-btn>
    <v-btn
      icon
      small
      class="mr-2"
      :disabled="!canMoveCamera(cameraKey, 1)"
      @click="moveCamera(cameraKey, 1)"
    >
      <v-icon>mdi-arrow-down</v-icon>
    </v-btn>
    <slot />
  </v-row>
</template>
