<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import MultiTraining from './MultiTrainingMenu.vue';
import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';

export default defineComponent({
  components: {
    BrowserLink,
    NavigationBar,
    MultiTraining,
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container>
      <multi-training />
    </v-container>
  </v-main>
</template>
