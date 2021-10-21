<script lang="ts">
import {
  defineComponent, PropType, watch,
  ref, Ref,
} from '@vue/composition-api';

export default defineComponent({
  name: 'ToolTipWidget',
  props: {
    color: {
      type: Function as PropType<(name: string) => string>,
      required: true,
    },
    textSettings: {
      type: Function as PropType<(name: string) => { showLabel: boolean; showConfidence: boolean }>,
      default: () => ({ showLabel: true, showConfidence: true }),
    },
    dataList: {
      type: Object as PropType<Ref<[string, number][]>>,
      default: () => [],
    },
  },
  setup(props) {
    return {
    };
  },
});
</script>

<template>
  <v-card
    v-if="dataList.value.length"
    dark
    max-width="200px"
    class="d-inline-flex pa-2"
  >
    <div>
      <div
        v-for="(item, index) in dataList.value"
        :key="index"
      >
        <span
          v-if="color(item[0])"
          :style="{ color: color(item[0]) }"
          class="pr-1 pb-1"
        >
          █
        </span>
        <span>{{ `${item[0]}:${item[1]}` }}</span>
      </div>
    </div>
  </v-card>
</template>
