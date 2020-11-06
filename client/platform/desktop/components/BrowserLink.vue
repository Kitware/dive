<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import { openLink } from '../api/main';

export default defineComponent({
  props: {
    href: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    function open() {
      openLink(props.href);
    }
    return { open };
  },
});
</script>

<template>
  <span
    class="link"
    @click="open"
  >
    <slot />
  </span>
</template>

<style scoped>
.link {
  display: block;
  color: var(--v-primary-lighten3);
  cursor: pointer;
}
</style>
