<script lang="ts">
import { defineComponent, reactive } from '@vue/composition-api';
import Vue from 'vue';
import TypeThreshold from './TypeThreshold.vue';

const bus = new Vue();
export function useContextualSidebar() {
  function toggle(componentName: string) {
    bus.$emit('toggle', componentName);
    window.dispatchEvent(new Event('resize'));
  }
  return { toggle };
}
/**
 * ContextSidebar is a singleton contextual sidebar that shows content based on
 * launch instructions. It's a bit like the promp service, but with less overhead.
 *
 * Contextual component events:
 *   - "close": close the context window
 */
export default defineComponent({
  props: {
    width: {
      type: Number,
      default: 300,
    },
  },

  components: {
    TypeThreshold,
  },

  setup() {
    const state = reactive({
      componentName: null as string | null,
    });
    const contextualSidebar = useContextualSidebar();
    bus.$on('toggle', (componentName: string) => {
      if (state.componentName === componentName) {
        state.componentName = null;
      } else {
        state.componentName = componentName;
      }
    });
    return {
      contextualSidebar,
      state,
    };
  },
});
</script>

<template>
  <div>
    <v-card
      v-if="state.componentName !== null"
      :width="width"
      tile
      outlined
      class="d-flex flex-column sidebar"
      style="z-index:1;"
    >
      <v-card-title class="py-1">
        Context Menu
        <v-spacer />
        <v-btn
          icon
          color="white"
          @click="contextualSidebar.toggle(state.componentName)"
        >
          <v-icon>
            mdi-close
          </v-icon>
        </v-btn>
      </v-card-title>
      <v-card-subtitle class="py-1">
        {{ state.componentName }}
      </v-card-subtitle>
      <div class="sidebar-content">
        <component
          :is="state.componentName"
        />
      </div>
    </v-card>
  </div>
</template>

<style scoped lang="scss">
.sidebar {
  height: calc(100vh - 112px);
  overflow-y: hidden;
}
.sidebar-content {
  overflow-y: auto;
}
</style>
