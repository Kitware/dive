<script>
import NavigationBar from 'viame-web-common/components/NavigationBar.vue';
import AttributeSettings from 'viame-web-common/components/AttributeSettings.vue';

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
