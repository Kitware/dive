<script lang="ts">
import { computed, defineComponent } from 'vue';
import context from 'dive-common/store/context';

export default defineComponent({
  props: {
    width: {
      type: Number,
      default: 300,
    },
    bottomMode: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const options = computed(() => Object.entries(context.componentMap).map(([value, entry]) => ({
      text: entry.description,
      value,
    })));
    const sidebarStyle = computed(() => {
      if (props.bottomMode) {
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
      class="d-flex flex-column"
      :style="sidebarStyle"
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
.sidebar-content {
  overflow-y: auto;
}
</style>
