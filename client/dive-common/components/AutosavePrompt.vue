<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'AutosavePrompt',
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['update:modelValue', 'save'],
});
</script>
<template>
  <v-dialog
    max-width="500"
    persistent
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card variant="outlined">
      <v-card-text class="py-4">
        <p class="text-h5">
          Do you want to save changes first?
        </p>
        <v-alert
          density="compact"
          variant="outlined"
          type="warning"
        >
          There are unsaved changes to this dataset.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="$emit('update:modelValue', false)"
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
