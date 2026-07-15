<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import {
  useAlignedView,
  useCameraRegistration,
} from 'vue-media-annotator/provides';
import context from 'dive-common/store/context';
import alignedViewTooltipText from './alignedViewTooltip';

/**
 * Multicam toolbar control for SEAL-TK features 2 + 3: warp every camera's
 * display into the reference camera's space and link pan/zoom across panes.
 * Usable when a transform exists for every non-reference camera; shown
 * (disabled) for every multicam dataset so an incomplete calibration reads
 * as "needs calibration" rather than the button silently disappearing.
 *
 * Hover opens a small menu with status copy and a shortcut into the Camera
 * Registration context panel. Parent is expected to mount this only for
 * multicam datasets (`multiCamList.length > 1`).
 */
export default defineComponent({
  name: 'AlignedViewToggle',
  setup() {
    const alignedView = useAlignedView();
    const cameraRegistration = useCameraRegistration();
    const menuOpen = ref(false);

    const available = computed(() => alignedView.available.value);
    const enabled = computed(() => alignedView.enabled.value);
    // The aligned view is suspended while picking, so the button reads as
    // unavailable rather than accepting a toggle that has no visible effect.
    const pickingEnabled = computed(() => cameraRegistration.pickingEnabled.value);

    const tip = computed(() => {
      const text = alignedViewTooltipText({
        isMultiCamera: true,
        enabled: enabled.value,
        // Track the reactive source stamp before calling the helper so Vue
        // re-runs this computed when producer provenance changes.
        sourceIsMixed: cameraRegistration.sourceIsMixed(),
        progress: alignedView.registrationProgress.value,
      });
      if (pickingEnabled.value) {
        return `${text} — unavailable while picking registration points`;
      }
      return text;
    });

    const toggle = () => {
      alignedView.setEnabled(!alignedView.enabled.value);
    };

    const openCameraRegistration = () => {
      menuOpen.value = false;
      context.openClose('CameraRegistration', true);
    };

    return {
      available,
      enabled,
      pickingEnabled,
      tip,
      menuOpen,
      toggle,
      openCameraRegistration,
    };
  },
});
</script>

<template>
  <v-menu
    v-model="menuOpen"
    open-on-hover
    bottom
    offset-y
    :nudge-bottom="4"
    :close-on-content-click="false"
    open-delay="250"
    close-delay="300"
    max-width="280"
  >
    <template #activator="{ on, attrs }">
      <!-- span wrapper: a disabled v-btn swallows the menu's hover events -->
      <span
        v-bind="attrs"
        v-on="on"
      >
        <v-btn
          icon
          small
          class="mx-1"
          :color="enabled ? 'primary' : 'default'"
          :disabled="!available || pickingEnabled"
          @click="toggle"
        >
          <v-icon>
            {{ enabled ? 'mdi-vector-intersection' : 'mdi-vector-difference' }}
          </v-icon>
        </v-btn>
      </span>
    </template>
    <v-card
      class="pa-3"
      outlined
    >
      <div class="text-body-2 mb-3 align-tip">
        {{ tip }}
      </div>
      <v-btn
        small
        block
        color="primary"
        outlined
        @click="openCameraRegistration"
      >
        <v-icon
          left
          small
        >
          mdi-camera
        </v-icon>
        Camera Registration
      </v-btn>
    </v-card>
  </v-menu>
</template>

<style scoped>
.align-tip {
  line-height: 1.35;
  white-space: normal;
}
</style>
