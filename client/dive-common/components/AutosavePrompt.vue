<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  name: 'AutosavePrompt',
  props: {
    value: {
      type: Boolean,
      required: true,
    },
  },
});
</script>
<template>
  <v-dialog
    max-width="500"
    persistent
    :value="value"
    :overlay-opacity="0.95"
  >
    <v-card outlined>
      <v-card-text class="py-4">
        <p class="text-h5">
          Do you want to save changes first?
        </p>
        <v-alert
          dense
          outlined
          type="warning"
        >
          There are unsaved changes to this dataset.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          depressed
          text
          @click="$emit('input', false)"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          @click="$emit('save')"
        >
          Save and Export
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
