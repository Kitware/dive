<script lang="ts">
import { computed, defineComponent } from 'vue';
import context from 'dive-common/store/context';

export default defineComponent({
  props: {
    width: {
      type: Number,
      default: 300,
    },
    sidebarMode: {
      type: String,
      default: 'left',
    },
  },
  setup(props) {
    const options = computed(() => Object.entries(context.componentMap).map(([value, entry]) => ({
      text: entry.description,
      value,
    })));
    const sidebarStyle = computed(() => {
      if (props.sidebarMode === 'bottom') {
        // In bottom mode, use fixed positioning to overlay on the right side
        // Position above the bottom bar (260px) and below the top bar + visibility controls (~112px)
        return {
          position: 'fixed',
          top: '112px',
          right: '0',
          height: 'calc(100vh - 112px - 260px)',
          overflowY: 'hidden',
          zIndex: 10,
        };
      }
      return {
        height: 'calc(100vh - 112px)',
        overflowY: 'hidden',
        zIndex: 1,
      };
    });
    return { context, options, sidebarStyle };
  },
});
</script>

<template>
  <div>
    <v-card
      v-if="context.state.active !== null"
      :width="width"
      tile
      outlined
      class="d-flex flex-column context-sidebar-panel"
      :style="sidebarStyle"
    >
      <div class="context-header d-flex align-center mx-1">
        <v-select
          :items="options"
          :model-value="context.state.active"
          item-title="text"
          item-value="value"
          density="compact"
          variant="solo"
          hide-details
          class="context-select flex-grow-1"
          @update:model-value="context.toggle($event)"
        />
        <v-icon
          color="white"
          class="context-close-icon"
          @click="context.toggle(null)"
        >
          mdi-close
        </v-icon>
      </div>
      <div class="sidebar-content">
        <slot
          v-bind="{ name: context.state.active, subCategory: context.state.subCategory }"
        />
      </div>
    </v-card>
  </div>
</template>

<style scoped lang="scss">
.context-sidebar-panel {
  transition: none !important;
}

.context-header {
  gap: 4px;
  min-width: 0;
}

.context-select {
  min-width: 0;
}

.context-close-icon {
  flex-shrink: 0;
  cursor: pointer;
}

.sidebar-content {
  overflow-y: auto;
}
</style>
