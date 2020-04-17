<script>
import NavigationBar from '@/components/NavigationBar.vue';
import AttributeSettings from '@/components/AttributeSettings.vue';

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
