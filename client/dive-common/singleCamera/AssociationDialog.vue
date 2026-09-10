<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    camera: { type: String, default: '' },
    /** Non-empty when Yes must be hidden; shown so the user knows why. */
    unavailableReason: { type: String, default: '' },
  },
  emits: ['answer'],
});
</script>

<template>
  <v-dialog :value="!!camera" persistent max-width="560">
    <v-card>
      <v-card-title>
        {{ unavailableReason ? 'Keep detections on separate cameras?' : 'Associate detections across cameras?' }}
      </v-card-title>
      <v-card-text>
        <template v-if="unavailableReason">
          Another camera already has detections. After running the pipeline on {{ camera }},
          DIVE will assign new IDs above all IDs on the other cameras so they do not collide.
          Association is unavailable: {{ unavailableReason }}
        </template>
        <template v-else>
          Another camera already has detections. After running the pipeline on {{ camera }},
          should DIVE associate its detections with those on the other camera?
          Choosing Yes replaces annotations on both cameras with the paired association result.
          Choosing No keeps cameras separate and assigns new IDs above all IDs on the other cameras.
        </template>
      </v-card-text>
      <v-card-actions>
        <v-btn text @click="$emit('answer', null)">
          Cancel
        </v-btn>
        <v-spacer />
        <v-btn
          :text="!unavailableReason"
          :color="unavailableReason ? 'primary' : undefined"
          @click="$emit('answer', 'separate')"
        >
          {{ unavailableReason ? 'Continue' : 'No' }}
        </v-btn>
        <v-btn
          v-if="!unavailableReason"
          color="primary"
          @click="$emit('answer', 'associate')"
        >
          Yes
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
