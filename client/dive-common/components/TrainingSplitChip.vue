<script lang="ts">
import { computed, defineComponent } from 'vue';
import { trainingSplitOption } from 'dive-common/trainingSplit';

/** Colored label for a dataset's training split; renders nothing when unset. */
export default defineComponent({
  name: 'TrainingSplitChip',
  props: {
    split: {
      type: String,
      default: null,
    },
    xSmall: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const option = computed(() => trainingSplitOption(props.split));
    return { option };
  },
});
</script>

<template>
  <v-chip
    v-if="option"
    :color="option.color"
    :x-small="xSmall"
    :small="!xSmall"
    outlined
    label
    class="training-split-chip"
  >
    {{ option.text }}
  </v-chip>
</template>

<style scoped>
.training-split-chip {
  pointer-events: none;
}
</style>
