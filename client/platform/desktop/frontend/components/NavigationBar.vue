<script>
import { defineComponent } from 'vue';
import JobTab from './JobTab.vue';

export default defineComponent({
  components: { JobTab },
  props: {
    name: {
      type: String,
      default: 'DIVE',
    },
  },
});
</script>

<template>
  <v-app-bar app>
    <v-tabs
      stacked
      color="accent"
      class="viewer-nav-tabs flex-grow-0 flex-shrink-0"
    >
      <v-tab :to="{ name: 'recent' }">
        Library
        <v-icon>mdi-folder-open</v-icon>
      </v-tab>
      <job-tab />
      <v-tab :to="{ name: 'training' }">
        Training<v-icon>mdi-brain</v-icon>
      </v-tab>
      <v-tab :to="{ name: 'pipeline' }">
        Pipeline<v-icon>mdi-pipe</v-icon>
      </v-tab>
      <v-tab :to="{ name: 'settings' }">
        Settings<v-icon>mdi-cog</v-icon>
      </v-tab>
    </v-tabs>
    <v-spacer />
  </v-app-bar>
</template>
