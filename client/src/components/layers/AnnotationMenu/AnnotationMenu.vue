<script lang="ts">
import Vue from 'vue';

import TooltipBtn from '@/components/TooltipButton.vue';


export default Vue.extend({
  name: 'AnnotationMenu',
  components: {
    TooltipBtn,
  },
  data() {
    return {
      visible: false,
      keyframe: false,
      color: null,
    };
  },
});
</script>
<template>
  <div
    v-if="visible"
    class="menuItem"
  >
    <tooltip-btn
      :icon="(keyframe)
        ? 'mdi-star'
        : 'mdi-star-outline'"
      tooltip-text="Toggle keyframe"
      :color="color"
      @click="$emit('AnnotationMenu', {type:'toggleKeyframe'})"
    />
  </div>
</template>

<style lang="scss" scoped>
.menuItem {
  position: absolute;
  z-index: 3000;
}
</style>
