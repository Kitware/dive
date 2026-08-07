<script lang="ts">
import {
  computed, defineComponent, ref,
} from 'vue';
import type { AutoRegisterRunOptions } from 'dive-common/use/useAutoRegisterJob';

/**
 * Launch dialog for the auto-register pipeline: only the knobs worth
 * changing. The candidate spread itself is proposed automatically
 * (stratified time bins, ranked by camera sync where timestamps exist) and
 * reviewed after the matching -- the matcher is the best measurement of
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
    const maxFrames = ref(12);
    const candidatesPerBin = ref(2);
    const minInliers = ref(30);
    const pairMode = ref<'all' | 'star'>('all');
    const replaceExisting = ref(false);

    const isTriplet = computed(() => props.cameraCount >= 3);
    const candidateTotal = computed(() => maxFrames.value * candidatesPerBin.value);
    const matcherRuns = computed(() => {
      const pairCount = isTriplet.value ? (pairMode.value === 'all' ? 3 : 2) : 1;
      return maxFrames.value * pairCount;
    });

    function close() {
      emit('input', false);
    }
    function run() {
      const options: AutoRegisterRunOptions = {
        maxFrames: maxFrames.value,
        candidatesPerBin: candidatesPerBin.value,
        minInliers: minInliers.value,
        replaceExisting: replaceExisting.value,
        // A star to the reference (inputs 1-2, 1-3) is the minimum a
        // spanning tree needs; all-pairs additionally buys the
        // loop-closure consistency check.
        ...(isTriplet.value && pairMode.value === 'star' ? { pairs: '1-2,1-3' } : {}),
      };
      emit('run', options);
      close();
    }
    return {
      maxFrames,
      candidatesPerBin,
      minInliers,
      pairMode,
      replaceExisting,
      isTriplet,
      candidateTotal,
      matcherRuns,
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
          Proposes {{ candidateTotal }} candidate frames spread across the
          whole {{ isTriplet ? 'rig' : 'sequence' }} (ranked by camera sync
          where timestamps exist), matches the best one per time bin, and
          pools one transform per camera pair over every kept frame. Results
          merge with existing points frame by frame; review and exclude
          frames afterwards from the panel's frame list.
        </p>
        <v-text-field
          v-model.number="maxFrames"
          label="Registration frames (time bins)"
          type="number"
          min="1"
          max="50"
          dense
          outlined
          hide-details
          class="mb-3"
        />
        <v-text-field
          v-model.number="candidatesPerBin"
          label="Candidates per bin"
          type="number"
          min="1"
          max="5"
          dense
          outlined
          hide-details
          class="mb-3"
        />
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
        <v-radio-group
          v-if="isTriplet"
          v-model="pairMode"
          dense
          hide-details
          class="mt-0 mb-3"
        >
          <template #label>
            <span class="text-caption">
              Camera pairs ({{ matcherRuns }} matcher runs)
            </span>
          </template>
          <v-radio
            value="all"
            label="All pairs (adds the triplet consistency check)"
          />
          <v-radio
            value="star"
            label="Star to the reference camera (faster; minimum spanning set)"
          />
        </v-radio-group>
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
