<script lang="ts">
import { defineComponent, PropType } from 'vue';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';

/**
 * One row of the registration-frames list: an observation (image pair) of
 * the active camera pair, with its fit-inclusion toggle and quality readout.
 */
export interface FrameRow {
  /** The pair's camA-local frame: the identity every panel action works in. */
  frame: number | null;
  /**
   * The same capture as a global aligned-timeline slot -- what the frame
   * readout and scrubber display. Shown instead of `frame` so the panel agrees
   * with the rest of the viewer; they differ by however many frames camA has
   * dropped. Falls back to `frame` when there is no aligned timeline.
   */
  displayFrame: number | null;
  imageA: string;
  imageB: string;
  enabled: boolean;
  source: string;
  count: number;
  /** Reprojection RMS of this observation's points against the pooled fit. */
  rmsPx: number | null;
  /** Machine-readable reason a producer rejected this candidate, if any. */
  skipped: string | null;
  /** Whether the viewer currently displays this image pair. */
  current: boolean;
}

/**
 * The registration-frames list (multi-image-pair selector AND quality
 * readout) for the active camera pair: one row per observation with its
 * point count, per-frame agreement with the pooled fit (colored dot + RMS),
 * an enable checkbox that excludes the frame from the fit without deleting
 * its points, jump-to-frame, and per-frame delete. Unresolved rows (images
 * not in this dataset) are listed with a warning instead of a frame number.
 */
export default defineComponent({
  name: 'RegistrationFrameList',
  components: { TooltipBtn },
  props: {
    rows: {
      type: Array as PropType<FrameRow[]>,
      required: true,
    },
  },
  setup(props, { emit }) {
    /**
     * Agreement dot: green when the observation tracks the pooled fit,
     * yellow when it strains it, red when it disagrees, grey with no fit
     * (or no points to measure).
     */
    function rmsColor(row: FrameRow): string {
      if (row.rmsPx === null) {
        return 'grey';
      }
      if (row.rmsPx < 3) {
        return 'success';
      }
      if (row.rmsPx < 6) {
        return 'warning';
      }
      return 'error';
    }
    function toggle(row: FrameRow, enabled: unknown) {
      emit('toggle', row, Boolean(enabled));
    }
    function jump(row: FrameRow) {
      if (row.frame !== null) {
        emit('jump', row.frame);
      }
    }
    function remove(row: FrameRow) {
      emit('remove', row);
    }
    return {
      rmsColor, toggle, jump, remove,
    };
  },
});
</script>

<template>
  <div>
    <div
      v-for="row in rows"
      :key="`${row.imageA}::${row.imageB}::${row.source}`"
      class="d-flex align-center text-caption frame-row"
      :class="{ 'frame-row--current': row.current }"
    >
      <v-simple-checkbox
        :value="row.enabled"
        :disabled="row.count === 0"
        :ripple="false"
        dense
        class="mr-0"
        @input="toggle(row, $event)"
      />
      <span
        v-if="row.displayFrame !== null"
        class="frame-label"
      >
        {{ row.displayFrame }}
      </span>
      <v-tooltip
        v-else
        bottom
        open-delay="200"
      >
        <template #activator="{ on }">
          <span
            class="frame-label warning--text"
            v-on="on"
          >
            <v-icon
              x-small
              color="warning"
            >
              mdi-alert
            </v-icon>
          </span>
        </template>
        <span>
          Images not in this dataset ({{ row.imageA }} / {{ row.imageB }}) —
          these points don't render here but stay in the file.
        </span>
      </v-tooltip>
      <span class="mx-1">{{ row.count }} pts</span>
      <template v-if="row.skipped">
        <v-tooltip
          bottom
          open-delay="200"
        >
          <template #activator="{ on }">
            <span
              class="grey--text mx-1"
              v-on="on"
            >
              skipped: {{ row.skipped }}
            </span>
          </template>
          <span>The auto-register job rejected this candidate ({{ row.skipped }}).</span>
        </v-tooltip>
      </template>
      <template v-else>
        <span
          class="mx-1"
          :class="`${rmsColor(row)}--text`"
        >
          {{ row.rmsPx !== null ? `rms ${row.rmsPx.toFixed(1)} px` : '—' }}
        </span>
        <v-icon
          x-small
          :color="rmsColor(row)"
        >
          mdi-circle
        </v-icon>
      </template>
      <v-spacer />
      <tooltip-btn
        icon="mdi-target"
        :disabled="row.frame === null"
        tooltip-text="Jump to this frame"
        @click="jump(row)"
      />
      <tooltip-btn
        color="error"
        icon="mdi-close"
        tooltip-text="Remove this frame's points from the registration"
        @click="remove(row)"
      />
    </div>
  </div>
</template>

<style scoped>
.frame-row {
  min-height: 26px;
}
.frame-row--current {
  background-color: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
}
.frame-label {
  font-family: monospace;
  min-width: 42px;
  display: inline-block;
}
</style>
