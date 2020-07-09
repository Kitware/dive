
<script>
import TooltipBtn from '@/components/TooltipButton.vue';

export default {
  name: 'AnnotationMenu',
  components: {
    TooltipBtn,
  },
  data() {
    return {
    };
  },
};
</script>
<template>
  <div
    class="menuItem"
    :style="{top:`${position.x}px`, left:`${position.y}px`}"
  >
    <tooltip-btn
      :icon="(keyframe)
        ? 'mdi-star'
        : 'mdi-star-outline'"
      tooltip-text="Toggle keyframe"
      @click="$emit('ToggleKeyFrame')"
    />
  </div>
</template>

<style lang="scss" scoped>
.menuItem {
  position: absolute;
  z-index: 3000;
  bottom: 0;
  right: 0;
  width: 20px;
  height: 20px;
  background: rgba(0, 0, 0, 0.8);
  overflow-y: auto;
}
</style>
