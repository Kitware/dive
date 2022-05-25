<script lang="ts">
import {
  defineComponent, PropType, Ref,
} from '@vue/composition-api';
import { StateStyles } from '../../StyleManager';
import { ToolTipWidgetData } from './UILayerTypes';
/*
  This Component will be mounted indepedently of the main Vue App
  on a GeoJS canvas element.  To ensure reactivity between the main Vue App
  and this element the props are passed in the initalization function instead of on a template.
  This is why reactivate data in this component is utilizing PropType<Ref<data>>.
  All references to reactive PropType<Ref<data>> need to be derefernced in the template as well.
 */
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
      type: Object as PropType<Ref<ToolTipWidgetData[]>>,
      default: () => [],
    },
    selected: {
      type: Object as PropType<Ref<number|null>>,
      required: true,
    },
  },
  setup(props) {
    const coloring = (data: ToolTipWidgetData) => {
      if (data.trackId === props.selected.value) {
        return props.stateStyling.selected.color;
      }
      return props.color(data.type);
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
        <span>{{ `${item.type}:${item.confidence.toFixed(2)}` }}</span>
      </div>
    </div>
  </v-card>
</template>
