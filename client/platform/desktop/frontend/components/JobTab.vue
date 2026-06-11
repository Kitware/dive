<script lang="ts">
import { defineComponent } from 'vue';
import { runningJobs } from '../store/jobs';

export default defineComponent({
  setup() {
    return { runningJobs };
  },
});
</script>

<template>
  <v-tab :to="{ name: 'jobs' }">
    Jobs
    <v-badge
      :model-value="runningJobs.length >= 1"
      location="bottom end"
      :offset-x="-6"
      :offset-y="28"
    >
      <template #badge>
        <v-icon
          class="rotate"
        >
          mdi-spin mdi-sync
        </v-icon>
      </template>
      <v-icon>mdi-format-list-checks</v-icon>
    </v-badge>
  </v-tab>
</template>
