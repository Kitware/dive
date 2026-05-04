<script lang="ts">
import { defineComponent } from 'vue';
import { clientSettings } from 'dive-common/store/settings';

export default defineComponent({
  name: 'UserSettingsDialog',
  props: {
    value: {
      type: Boolean,
      required: true,
    },
  },
  setup() {
    return {
      clientSettings,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="500"
    @input="$emit('input', $event)"
  >
    <v-card>
      <v-card-title>User Settings</v-card-title>
      <v-card-text>
        <v-switch
          v-model="clientSettings.multiCamSettings.showToolbar"
          color="primary"
          class="my-0"
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
          min="1"
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
