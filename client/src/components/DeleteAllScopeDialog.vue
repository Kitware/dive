<script lang="ts">
import { defineComponent, PropType } from 'vue';
import type { ThresholdScope } from '../BaseFilterControls';

/* Deleting everything a list shows: the list only holds what passes the
   confidence thresholds, so ask which side of them the delete should reach. */
export default defineComponent({
  name: 'DeleteAllScopeDialog',
  props: {
    value: { type: Boolean, required: true },
    scope: { type: String as PropType<ThresholdScope>, required: true },
    lead: { type: String, required: true },
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    width="480"
    @input="$emit('input', $event)"
  >
    <v-card>
      <v-card-title>Delete all tracks?</v-card-title>
      <v-card-text>
        <p class="mb-2">
          {{ lead }}
        </p>
        <v-radio-group
          :value="scope"
          class="mt-0"
          hide-details
          @change="$emit('update:scope', $event)"
        >
          <v-radio
            label="All tracks, regardless of threshold"
            value="all"
          />
          <v-radio
            label="Above the current threshold (what the list shows)"
            value="above"
          />
          <v-radio
            label="Below the current threshold (hidden from the list)"
            value="below"
          />
        </v-radio-group>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          text
          @click="$emit('input', false)"
        >
          Cancel
        </v-btn>
        <v-btn
          color="error"
          text
          @click="$emit('confirm')"
        >
          Delete
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
