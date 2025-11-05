<script lang="ts">
import {
  defineComponent,
  ref,
} from 'vue';

import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';
import JobsHistory from './JobsHistory.vue';
import JobsQueued from './JobsQueued.vue';

export default defineComponent({
  components: {
    BrowserLink,
    NavigationBar,
    JobsHistory,
    JobsQueued,
  },
  setup() {
    const tab = ref(0);
    return {
      tab,
    };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-tabs
      v-model="tab"
      centered
    >
      <v-tab style="flex-grow:1">
        Job History
      </v-tab>
      <v-tab style="flex-grow:1">
        Queued Jobs
      </v-tab>
    </v-tabs>
    <v-tabs-items v-model="tab">
      <v-tab-item>
        <jobs-history />
      </v-tab-item>
      <v-tab-item>
        <jobs-queued />
      </v-tab-item>
    </v-tabs-items>
  </v-main>
</template>
