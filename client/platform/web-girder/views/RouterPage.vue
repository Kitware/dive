<script>
import NavigationBar from './NavigationBar.vue';

export default {
  name: 'Config',
  components: { NavigationBar },
};
</script>

<template>
  <v-main>
    <NavigationBar />
    <router-view />
  </v-main>
</template>
