<script lang="ts">
import {
  computed, defineComponent, ref,
} from 'vue';
import type { AutoRegisterRunOptions } from 'dive-common/use/useAutoRegisterJob';

/**
 * Launch dialog for the auto-register pipeline: only the knobs worth
 * changing. Frames are spread evenly across the dataset (skipping captures
 * whose cameras are out of sync) and reviewed after the matching -- the
 * matcher is the best measurement of
 * whether a frame has usable dense features, and excluding a frame
 * afterwards is a free client-side refit.
 */
export default defineComponent({
  name: 'AutoRegisterDialog',
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    cameraCount: {
      type: Number,
      required: true,
    },
    running: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const frames = ref(12);
    const minInliers = ref(30);
    const replaceExisting = ref(false);

    const isTriplet = computed(() => props.cameraCount >= 3);

    function close() {
      emit('input', false);
    }
    function run() {
      const options: AutoRegisterRunOptions = {
        frames: frames.value,
        minInliers: minInliers.value,
        replaceExisting: replaceExisting.value,
      };
      emit('run', options);
      close();
    }
    return {
      frames,
      minInliers,
      replaceExisting,
      isTriplet,
      close,
      run,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="420"
    @input="$emit('input', $event)"
  >
    <v-card>
      <v-card-title>Auto Register Frames</v-card-title>
      <v-card-text>
        <p class="text-body-2">
          Matches {{ frames }} frames spread evenly across the whole
          {{ isTriplet ? 'rig' : 'sequence' }} (skipping captures whose cameras
          are out of sync) and pools one transform per camera pair over every
          frame that passes the matcher's checks. Results
          merge with existing points frame by frame; review and exclude
          frames afterwards from the panel's frame list.
        </p>
        <v-text-field
          v-model.number="frames"
          label="Registration frames"
          type="number"
          min="1"
          max="50"
          dense
          outlined
          persistent-hint
          hint="10-20 is usually right: the pooled fit converges by about 10
                frames, and beyond that extra frames mainly tighten triplet
                consistency. Cost is roughly linear in frames."
          class="mb-3"
        />
        <v-alert
          v-if="frames < 5"
          dense
          outlined
          type="warning"
          class="text-caption py-1 mb-3"
        >
          Very few frames overfit. One frame fits its own points perfectly --
          100% inliers, near-zero RMS -- while producing the least consistent
          rig of any setting, so the quality readouts will look their best
          exactly when they are least trustworthy.
        </v-alert>
        <v-text-field
          v-model.number="minInliers"
          label="Min inliers per frame"
          type="number"
          min="4"
          max="500"
          dense
          outlined
          hide-details
          class="mb-3"
        />
        <v-checkbox
          v-model="replaceExisting"
          label="Replace previous auto-registered frames"
          dense
          hide-details
          class="mt-0"
        />
        <span class="text-caption grey--text d-block mt-1">
          Hand-picked points always survive; this only clears earlier
          matcher results before the new run.
        </span>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          text
          @click="close"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="running"
          @click="run"
        >
          <v-icon
            small
            left
          >
            mdi-auto-fix
          </v-icon>
          Run
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
