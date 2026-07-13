<script lang="ts">
import { computed, defineComponent } from 'vue';
import {
  useAlignedView,
  useCameraRegistration,
} from 'vue-media-annotator/provides';
import alignedViewTooltipText from './alignedViewTooltip';

/**
 * Multicam toolbar control for SEAL-TK features 2 + 3: warp every camera's
 * display into the reference camera's space and link pan/zoom across panes.
 * Usable when a transform exists for every non-reference camera; shown
 * (disabled) for every multicam dataset so an incomplete calibration reads
 * as "needs calibration" rather than the button silently disappearing.
 *
 * Parent is expected to mount this only for multicam datasets
 * (`multiCamList.length > 1`).
 */
export default defineComponent({
  name: 'AlignedViewToggle',
  setup() {
    const alignedView = useAlignedView();
    const cameraRegistration = useCameraRegistration();

    const available = computed(() => alignedView.available.value);
    const enabled = computed(() => alignedView.enabled.value);
    const tooltip = computed(() => alignedViewTooltipText({
      isMultiCamera: true,
      enabled: enabled.value,
      // Track the reactive source stamp before calling the helper so Vue
      // re-runs this computed when producer provenance changes.
      sourceIsMixed: cameraRegistration.sourceIsMixed(),
      progress: alignedView.registrationProgress.value,
    }));

    const toggle = () => {
      alignedView.setEnabled(!alignedView.enabled.value);
    };

    return {
      available,
      enabled,
      tooltip,
      toggle,
    };
  },
});
</script>

<template>
  <v-tooltip bottom>
    <template #activator="{ on }">
      <!-- span wrapper: a disabled v-btn swallows the tooltip's hover events -->
      <span v-on="on">
        <v-btn
          icon
          small
          class="mx-1"
          :color="enabled ? 'primary' : 'default'"
          :disabled="!available"
          @click="toggle"
        >
          <v-icon>
            {{ enabled ? 'mdi-vector-intersection' : 'mdi-vector-difference' }}
          </v-icon>
        </v-btn>
      </span>
    </template>
    <span>{{ tooltip }}</span>
  </v-tooltip>
</template>
