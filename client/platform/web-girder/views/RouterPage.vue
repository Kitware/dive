<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import NavigationBar from './NavigationBar.vue';

export default defineComponent({
  name: 'Config',
  components: { NavigationBar },
});
</script>

<template>
  <v-main>
    <NavigationBar />
    <router-view />
  </v-main>
</template>
