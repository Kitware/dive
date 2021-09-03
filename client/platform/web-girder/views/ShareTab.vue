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
    const { getters } = store;

    const clearSelected = () => {
      locationStore.selected = [];
    };

    return {
      locationStore,
      getters,
      clearSelected,
    };
  },
});
</script>

<template>
  <v-tabs
    right
    dense
    class="mx-1"
    @change="clearSelected"
  >
    <v-tab :to="getters['Location/locationRoute']">
      <v-icon class="mr-2">
        mdi-folder-multiple
      </v-icon>
      Browse Data
    </v-tab>
    <v-tab :to="{name: 'shared'}">
      <v-icon class="mr-2">
        mdi-share-variant
      </v-icon>
      Shared with Me
    </v-tab>
  </v-tabs>
</template>
