<script>
import { defineComponent } from '@vue/composition-api';

import NavigationTitle from 'viame-web-common/components/NavigationTitle.vue';

export default defineComponent({
  components: { NavigationTitle },
});
</script>
<template>
  <v-app-bar app>
    <NavigationTitle>VIAME</NavigationTitle>
    <v-tabs
      icons-and-text
      color="accent"
    >
      <v-tab
        :to="{ name: 'recent' }"
      >
        Recents
        <v-icon>mdi-folder-open</v-icon>
      </v-tab>
      <v-tab to="/settings">
        Settings<v-icon>mdi-settings</v-icon>
      </v-tab>
    </v-tabs>
    <v-spacer />
  </v-app-bar>
</template>
