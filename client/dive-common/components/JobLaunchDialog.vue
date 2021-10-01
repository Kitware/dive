<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    loading: {
      type: Boolean,
      default: false,
    },
    message: {
      type: String,
      default: '',
    },
    error: {
      type: String,
      default: '',
    },
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="400"
    @input="!$event && $emit('close')"
  >
    <v-card outlined>
      <v-card-title>
        Job Launch
      </v-card-title>
      <v-card-text
        class="d-flex justify-center"
      >
        <v-progress-circular
          v-if="loading"
          indeterminate
          size="60"
          width="9"
          color="primary"
        />
        <v-alert
          v-else-if="error"
          dense
          type="error"
        >
          {{ error }}
        </v-alert>
        <v-alert
          v-else-if="message"
          dense
          type="success"
        >
          {{ message }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          :to="{ name: 'jobs' }"
          depressed
        >
          View All Jobs
          <v-icon class="pl-1">
            mdi-format-list-checks
          </v-icon>
        </v-btn>
        <v-btn
          :color="error ? 'error' : 'primary'"
          :disabled="loading"
          @click="$emit('close')"
        >
          {{ error ? 'OK' : 'Done' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
