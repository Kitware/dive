<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import isDesktopRuntime from 'dive-common/isDesktopRuntime';
import type { GlobalStyleSettings } from 'dive-common/apispec';
import type { ReviewSettings } from 'dive-common/review/types';
import SavedStylesEditor from './Types/SavedStylesEditor.vue';

export default defineComponent({
  name: 'UserSettingsDialog',
  components: { SavedStylesEditor },
  props: {
    value: {
      type: Boolean,
      required: true,
    },
    /** When set, shows review chip-grid options at the top of the dialog. */
    reviewSettings: {
      type: Object as PropType<ReviewSettings | null>,
      default: null,
    },
  },
  setup(_, { emit }) {
    const colorScopeItems = [
      { text: 'Shared across all data', value: 'shared' },
      { text: 'Per dataset', value: 'dataset' },
    ];
    function onStylesChange(settings: GlobalStyleSettings) {
      emit('styles-change', settings);
    }
    return {
      clientSettings,
      colorScopeItems,
      isDesktopRuntime: isDesktopRuntime(),
      onStylesChange,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="560"
    @input="$emit('input', $event)"
  >
    <v-card>
      <v-card-title>User Settings</v-card-title>
      <v-card-text>
        <template v-if="reviewSettings">
          <div class="text-subtitle-2 mb-2">
            Review
          </div>
          <v-switch
            v-model="reviewSettings.activateOnHover"
            color="primary"
            class="my-0"
            label="Load and animate extra frames on hover"
            hint="When on, the first frame of every chip still loads; additional track frames download and cycle only while the pointer is over the entry."
            persistent-hint
          />
          <v-text-field
            v-model.number="reviewSettings.playbackFps"
            color="primary"
            class="my-0 mt-3"
            type="number"
            min="0"
            max="60"
            step="1"
            label="Chip playback (frames per second)"
            hint="0 = real-time from each dataset's frame rate and the spacing between sampled keyframes."
            persistent-hint
            dense
            outlined
          />
          <v-divider class="my-4" />
        </template>

        <v-select
          v-model="clientSettings.typeSettings.colorScope"
          :items="colorScopeItems"
          color="primary"
          item-color="primary"
          class="my-0"
          label="Type color scope"
          :hint="isDesktopRuntime
            ? 'Shared: reuse the same type/track colors across every sequence. '
              + 'Per dataset: colors are saved only with the dataset they were set on. '
              + 'Applies when a dataset is opened.'
            : 'Shared: reuse your type/track colors across every dataset. '
              + 'Per dataset: colors are saved only with the dataset they were set on. '
              + 'Applies when a dataset is opened.'"
          persistent-hint
          dense
          outlined
        />

        <v-divider class="my-4" />

        <SavedStylesEditor
          :active="value"
          @change="onStylesChange"
        />

        <v-divider class="my-4" />

        <v-switch
          v-if="isDesktopRuntime"
          v-model="clientSettings.multiCamSettings.showToolbar"
          color="primary"
          class="my-0 mt-3"
          label="Show multi-camera toolbar"
          hint="Show multi-camera tools in the top toolbar when a track is selected."
          persistent-hint
        />
        <v-switch
          v-model="clientSettings.autoSaveSettings.enabled"
          color="primary"
          class="my-0 mt-3"
          label="Auto-save annotations"
          hint="Automatically save annotation changes after a delay."
          persistent-hint
        />
        <v-text-field
          v-model.number="clientSettings.autoSaveSettings.delaySeconds"
          color="primary"
          class="my-0 mt-3"
          label="Auto-save delay (seconds)"
          hint="Number of seconds to wait after edits before auto-save runs."
          persistent-hint
          type="number"
          min="10"
          step="1"
          :disabled="!clientSettings.autoSaveSettings.enabled"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          text
          color="primary"
          @click="$emit('input', false)"
        >
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
