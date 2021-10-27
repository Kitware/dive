<script lang="ts">
import {
  defineComponent, PropType, Ref,
} from '@vue/composition-api';
import { StateStyles } from 'vue-media-annotator/use/useStyling';

export default defineComponent({
  name: 'ToolTipWidget',
  props: {
    color: {
      type: Function as PropType<(name: string) => string>,
      required: true,
    },
    stateStyling: {
      type: Object as PropType<StateStyles>,
      required: true,
    },
    textSettings: {
      type: Function as PropType<(name: string) => { showLabel: boolean; showConfidence: boolean }>,
      default: () => ({ showLabel: true, showConfidence: true }),
    },
    dataList: {
      type: Object as PropType<Ref<[string, number, number][]>>,
      default: () => [],
    },
    selected: {
      type: Object as PropType<Ref<number|null>>,
      required: true,
    },
  },
  setup(props) {
    const coloring = (data: [string, number, number]) => {
      if (data[2] === props.selected.value) {
        return props.stateStyling.selected.color;
      }
      return props.color(data[0]);
    };
    return {
      coloring,
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
          :style="{ color: coloring(item) }"
          class="pr-1 pb-1"
        >
          █
        </span>
        <span>{{ `${item[0]}:${item[1].toFixed(2)}` }}</span>
      </div>
    </div>
  </v-card>
</template>
