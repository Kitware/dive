<script>
import NavigationBar from 'app/components/NavigationBar.vue';
import AttributeSettings from 'app/components/AttributeSettings.vue';

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
