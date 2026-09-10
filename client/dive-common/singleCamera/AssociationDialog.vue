<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  props: { camera: { type: String, default: '' } },
});
</script>

<template>
  <v-dialog :value="!!camera" persistent max-width="560">
    <v-card>
      <v-card-title>Associate detections across cameras?</v-card-title>
      <v-card-text>
        Another camera already has detections. After running the pipeline on {{ camera }},
        should DIVE attempt to associate its detections with those on the other camera?
        Choosing No assigns new IDs above all IDs on the other cameras.
      </v-card-text>
      <v-card-actions>
        <v-btn text @click="$emit('answer', null)">
          Cancel
        </v-btn>
        <v-spacer />
        <v-btn text @click="$emit('answer', 'separate')">
          No
        </v-btn>
        <v-btn color="primary" @click="$emit('answer', 'associate')">
          Yes
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
