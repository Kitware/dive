<script lang="ts">
import Vue from 'vue';
import AttributeSettings from 'dive-common/components/AttributeSettings.vue';

export default Vue.extend({
  name: 'Settings',
  components: { AttributeSettings },
});
</script>

<template>
  <v-container>
    <AttributeSettings />
  </v-container>
</template>
