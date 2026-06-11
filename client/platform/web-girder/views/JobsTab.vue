<script lang="ts">
import { defineComponent } from 'vue';
import { useJobs } from 'platform/web-girder/store/useJobs';

export default defineComponent({
  name: 'JobsTab',
  setup() {
    const { runningJobIds } = useJobs();
    return { runningJobIds };
  },
});
</script>

<template>
  <v-tab to="/jobs">
    Jobs
    <v-badge
      :model-value="runningJobIds"
      location="bottom end"
      :offset-x="-6"
      :offset-y="16"
    >
      <template #badge>
        <v-icon
          class="rotate"
        >
          mdi-autorenew
        </v-icon>
      </template>
      <v-icon>mdi-format-list-checks</v-icon>
    </v-badge>
  </v-tab>
</template>
