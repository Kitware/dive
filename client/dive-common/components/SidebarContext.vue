<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import context from 'dive-common/store/context';

export default defineComponent({
  props: {
    width: {
      type: Number,
      default: 300,
    },
  },
  components: context.componentMap,
  setup() {
    return { context };
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
      class="d-flex flex-column sidebar"
      style="z-index:1;"
    >
      <v-card-title class="py-1">
        {{ context.componentMap[context.state.active].description }}
        <v-spacer />
        <v-btn
          icon
          color="white"
          @click="context.toggle(null)"
        >
          <v-icon>
            mdi-close
          </v-icon>
        </v-btn>
      </v-card-title>
      <div class="sidebar-content">
        <component
          :is="context.state.active"
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
