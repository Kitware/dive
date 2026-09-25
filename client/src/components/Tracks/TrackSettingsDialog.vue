<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'TrackSettingsDialog',
  props: {
    value: { type: Boolean, required: true },
  },
  emits: ['input'],
});
</script>

<template>
  <div class="d-inline-block">
    <v-tooltip
      open-delay="100"
      bottom
    >
      <template #activator="{ on }">
        <v-btn
          icon
          small
          class="mr-2"
          v-on="on"
          @click="$emit('input', true)"
        >
          <v-icon
            small
            :color="value ? 'accent' : 'default'"
          >
            mdi-cog
          </v-icon>
        </v-btn>
      </template>
      <span>Track settings</span>
    </v-tooltip>
    <v-dialog
      :value="value"
      max-width="680"
      scrollable
      @input="$emit('input', $event)"
    >
      <v-card>
        <v-card-title class="text-h6">
          Track Settings
          <v-spacer />
          <v-btn
            icon
            @click="$emit('input', false)"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text
          class="pt-4"
          style="max-height: 75vh;"
        >
          <slot v-if="value" />
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            @click="$emit('input', false)"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
