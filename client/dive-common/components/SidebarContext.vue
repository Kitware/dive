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
    function sidebarStyle(top: number) {
      if (props.sidebarMode === 'bottom') {
        // In bottom mode, use fixed positioning to overlay on the right side
        // Match the toolbar offset used by v-main and stop above the 260px bottom panel.
        return {
          position: 'fixed',
          top: `${top}px`,
          right: '0',
          height: `calc(100vh - ${top}px - 260px)`,
          overflowY: 'hidden',
          zIndex: 10,
        };
      }
      return {
        height: `calc(100vh - ${top}px)`,
        overflowY: 'hidden',
        zIndex: 1,
      };
    }
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
      :style="sidebarStyle($vuetify.application.top + $vuetify.application.bar)"
    >
      <div class="d-flex align-center mx-1">
        <v-select
          :items="options"
          :value="context.state.active"
          dense
          solo
          flat
          hide-details
          style="max-width: 240px;"
          @change="context.toggle($event)"
        />
        <v-spacer />
        <v-btn
          icon
          color="white"
          class="shrink"
          @click="context.toggle(null)"
        >
          <v-icon>
            mdi-close
          </v-icon>
        </v-btn>
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

.sidebar-content {
  overflow-y: auto;
}
</style>
