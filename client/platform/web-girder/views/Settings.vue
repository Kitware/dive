<script>
import AttributeSettings from 'viame-web-common/components/AttributeSettings.vue';
import NavigationBar from './NavigationBar.vue';

export default {
  name: 'Config',
  components: { NavigationBar, AttributeSettings },
};
</script>

<template>
  <v-main>
    <NavigationBar />
    <v-container>
      <AttributeSettings />
    </v-container>
  </v-main>
</template>
