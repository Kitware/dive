<script lang="ts">
import {
  defineComponent,
  PropType,
} from 'vue';
import { RootlessLocationType } from '../store/types';

export default defineComponent({
  name: 'DataSharedBreadCrumb',
  props: {
    path: {
      type: Array as PropType<RootlessLocationType[]>,
      default: [],
    },
  },
});
</script>

<template>
  <div class="bread-crumb-wrapper secondary darken-2">
    <v-icon
      small
      :color="path.length > 0 ? 'accent' : 'default'"
      @click="$emit('shared-click')">
      mdi-share-variant
    </v-icon>
    <div v-for="(pathPart, index) in path" :key="index">
      <span class="divider">/</span>
      <span v-if="index < path.length - 1" @click="$emit('folder-click', pathPart)" class="accent--text">{{ pathPart.name }}</span>
      <span v-else>{{ pathPart.name }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.bread-crumb-wrapper {
  display: flex;
  flex-direction: row;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;

  .divider {
    padding: 0 7px;
  }

  a {
    color: rgba(255, 255, 255, 0.5);
  }
}
</style>
