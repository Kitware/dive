<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useStore } from '../store/types';


export default defineComponent({
  name: 'ShareTab',
  props: {
    value: {
      type: Number,
      required: true,
    },
  },
  setup() {
    const store = useStore();
    const locationStore = store.state.Location;

    const clearSelected = () => {
      locationStore.selected = [];
    };

    return {
      locationStore,
      clearSelected,
    };
  },
});
</script>

<template>
  <v-tabs
    right
    @change="clearSelected"
  >
    <v-tab :to="{name: 'home'}">
      Browse Data
    </v-tab>
    <v-tab :to="{name: 'shared'}">
      Shared with Me
    </v-tab>
  </v-tabs>
</template>
