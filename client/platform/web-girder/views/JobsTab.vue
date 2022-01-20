<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useStore } from 'platform/web-girder/store/types';

export default defineComponent({
  name: 'JobsTab',
  setup() {
    const store = useStore();
    return { getters: store.getters };
  },
});
</script>

<template>
  <v-tab to="/jobs">
    Jobs
    <v-badge
      :value="getters['Jobs/runningJobIds']"
      overlap
      bottom
      offset-x="-6"
      offset-y="16"
    >
      <template slot="badge">
        <v-icon
          dark
          class="rotate"
        >
          mdi-autorenew
        </v-icon>
      </template>
      <v-icon>mdi-format-list-checks</v-icon>
    </v-badge>
  </v-tab>
</template>
