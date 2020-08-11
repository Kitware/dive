<script>
import NavigationBar from 'app/components/NavigationBar.vue';
import AttributeSettings from 'app/components/AttributeSettings.vue';

export default {
  name: 'Config',
  components: { NavigationBar, AttributeSettings },
};
</script>

<template>
  <v-content>
    <NavigationBar />
    <v-container>
      <AttributeSettings />
    </v-container>
  </v-content>
</template>
