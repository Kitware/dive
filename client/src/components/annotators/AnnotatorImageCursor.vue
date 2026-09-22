<script lang="ts">
import { defineComponent, toRef } from 'vue';

import useAnnotatorImageCursor from './useAnnotatorImageCursor';

export default defineComponent({
  name: 'AnnotatorImageCursor',
  props: {
    imageCursor: {
      type: String,
      default: '',
    },
    imageCursorEditing: {
      type: Boolean,
      default: false,
    },
    cursor: {
      type: String,
      default: 'default',
    },
  },
  setup(props) {
    const {
      displayImageCursor,
      segmentationCursorLoading,
      showEditBadge,
    } = useAnnotatorImageCursor(
      toRef(props, 'imageCursor'),
      toRef(props, 'cursor'),
      toRef(props, 'imageCursorEditing'),
    );

    return {
      displayImageCursor,
      segmentationCursorLoading,
      showEditBadge,
    };
  },
});
</script>

<template>
  <span class="annotator-image-cursor">
    <v-icon :class="{ 'mdi-spin': segmentationCursorLoading }">
      {{ displayImageCursor }}
    </v-icon>
    <v-icon
      v-if="showEditBadge"
      class="annotator-image-cursor__badge"
      small
    >
      mdi-pencil
    </v-icon>
  </span>
</template>

<style lang="scss" scoped>
.annotator-image-cursor {
  position: relative;
  display: inline-flex;
  line-height: 1;
}

.annotator-image-cursor__badge {
  position: absolute;
  right: -10px;
  bottom: -8px;
  font-size: 11px !important;
  width: 11px;
  height: 11px;
  background: transparent;
}
</style>
