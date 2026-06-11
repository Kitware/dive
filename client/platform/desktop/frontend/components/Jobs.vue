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
    <v-window v-model="tab">
      <v-window-item>
        <jobs-history />
      </v-window-item>
      <v-window-item>
        <jobs-queued />
      </v-window-item>
    </v-window>
  </v-main>
</template>
