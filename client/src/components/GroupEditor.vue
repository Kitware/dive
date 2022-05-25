<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';
import Group from '../Group';

export default defineComponent({
  name: 'GroupEditor',

  props: {
    group: {
      type: Object as PropType<Group>,
      required: true,
    },
  },

  setup() {
    return {};
  },
});
</script>

<template>
  <div>
    Group {{ group.id }}
  </div>
</template>
