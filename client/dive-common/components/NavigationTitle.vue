<script>
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'NavigationTitle',
  props: {
    name: {
      type: String,
      default: 'DIVE',
    },
  },
  computed: {
    version() {
      return process.env.VUE_APP_GIT_HASH;
    },
  },
});
</script>

<template>
  <v-toolbar-title class="my-title">
    <v-tooltip
      open-delay="200"
      location="bottom"
    >
      <template #activator="{ props: activatorProps }">
        <span v-bind="activatorProps">
          <slot>{{ name }}</slot>
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
