<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';

import { openLink } from '../api';

export default defineComponent({
  props: {
    href: {
      type: String,
      required: true,
    },
    display: {
      type: String as PropType<'block'|'inline'>,
      default: 'block',
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
    :style="{ display }"
    @click="open"
  >
    <slot />
  </span>
</template>

<style scoped>
.link {
  color: var(--v-primary-lighten3);
  cursor: pointer;
}
</style>
