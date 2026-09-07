<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import { GirderFileManager, GirderModelType } from '@girder/components/src';
import type { ScoringDatasetSummary } from 'dive-common/scoring/types';
import { useGirderRest } from 'platform/web-girder/plugins/girder';
import {
  finishScoringDatasetPicker,
  scoringDatasetPickerState,
} from 'platform/web-girder/api/scoringDatasetPicker';

type BrowserLocation = {
  _id: string;
  _modelType: GirderModelType;
  name?: string;
  login?: string;
  meta?: { annotate?: boolean | string; type?: string };
};

function isScoringDataset(loc: BrowserLocation): boolean {
  return loc._modelType === 'folder'
    && !!loc.meta?.annotate
    && loc.meta?.type !== 'multi';
}

function toSummary(loc: BrowserLocation): ScoringDatasetSummary {
  return {
    id: loc._id,
    name: loc.name || loc._id,
    type: typeof loc.meta?.type === 'string' ? loc.meta.type : undefined,
  };
}

export default defineComponent({
  name: 'ScoringDatasetPickerDialog',
  components: { GirderFileManager },
  setup() {
    const girderRest = useGirderRest();
    const location = ref<BrowserLocation | null>(null);
    const selected = ref<BrowserLocation | null>(null);

    function reset() {
      selected.value = null;
      location.value = girderRest.user?._id
        ? {
          _id: girderRest.user._id,
          _modelType: 'user',
          login: girderRest.user.login,
        }
        : null;
    }

    watch(() => scoringDatasetPickerState.open, (open) => {
      if (open) {
        reset();
      }
    });

    function setLocation(newLoc: BrowserLocation) {
      if (isScoringDataset(newLoc)) {
        selected.value = newLoc;
        return;
      }
      location.value = newLoc;
      selected.value = null;
    }

    const excluded = computed(
      () => !!selected.value
        && scoringDatasetPickerState.excludeIds.includes(selected.value._id),
    );

    const invalidSelection = computed(() => {
      if (!selected.value) return null;
      if (excluded.value) return 'This dataset is already in the list.';
      if (selected.value.meta?.type === 'multi') {
        return 'Multicamera parent folders cannot be scored; choose a camera dataset instead.';
      }
      if (!selected.value.meta?.annotate) {
        return 'Choose a DIVE dataset folder.';
      }
      return null;
    });

    const canAdd = computed(
      () => !!selected.value && isScoringDataset(selected.value) && !excluded.value,
    );

    function cancel() {
      finishScoringDatasetPicker(null);
    }

    function confirm() {
      if (!canAdd.value || !selected.value) return;
      finishScoringDatasetPicker(toSummary(selected.value));
    }

    return {
      scoringDatasetPickerState,
      location,
      selected,
      setLocation,
      invalidSelection,
      canAdd,
      cancel,
      confirm,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="scoringDatasetPickerState.open"
    max-width="800"
    :overlay-opacity="0.95"
    @input="(open) => { if (!open) cancel(); }"
  >
    <v-card v-if="location">
      <v-card-title>
        Choose a dataset
      </v-card-title>
      <v-card-text>
        Browse to a DIVE dataset and select it to score. Multicamera parent folders
        are not listed as scorable sequences.
        <v-card
          outlined
          flat
          class="mt-3"
        >
          <GirderFileManager
            root-location-disabled
            no-access-control
            :location="location"
            @update:location="setLocation"
          >
            <template #row="{ item }">
              <span>{{ item.name }}</span>
              <v-chip
                v-if="(item.meta && item.meta.annotate)"
                color="white"
                x-small
                outlined
                class="mx-3"
              >
                dataset
              </v-chip>
            </template>
          </GirderFileManager>
        </v-card>
        <div
          v-if="selected"
          class="text-body-2 mt-3"
        >
          Selected:
          <strong>{{ selected.name || selected._id }}</strong>
        </div>
        <div
          v-if="invalidSelection"
          class="text-caption warning--text mt-1"
        >
          {{ invalidSelection }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          text
          @click="cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!canAdd"
          @click="confirm"
        >
          Add sequence
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
