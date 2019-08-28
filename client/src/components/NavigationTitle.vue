<script>
export default {
  name: "NavigationTitle",
  computed: {
    version() {
      return process.env.VERSION;
    }
  }
};
</script>

<template>
  <v-toolbar-title>
    <v-tooltip open-delay="1000" bottom>
      <template #activator="{ on }">
        <span v-on="on"><slot /></span>
      </template>
      <span>v{{ version }}</span>
    </v-tooltip>
  </v-toolbar-title>
</template>
