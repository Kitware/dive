<script>
export default {
  name: 'NavigationTitle',
  computed: {
    version() {
      return process.env.VUE_APP_GIT_HASH;
    },
  },
};
</script>

<template>
  <v-toolbar-title class="my-title mx-5">
    <v-tooltip
      open-delay="200"
      bottom
    >
      <template #activator="{ on }">
        <span v-on="on">
          <slot>VIAME</slot>
        </span>
      </template>
      <span>{{ version }}</span>
    </v-tooltip>
  </v-toolbar-title>
</template>

<style lang="scss" scoped>
.my-title {
  overflow: unset;
}
</style>
