<script lang="ts">
import { defineComponent } from 'vue';
import { useLocation } from '../store/useLocation';

export default defineComponent({
  name: 'ShareTab',
  props: {
    value: {
      type: Number,
      required: true,
    },
  },
  setup() {
    const { locationRoute, setSelected } = useLocation();

    const clearSelected = () => {
      setSelected([]);
    };

    return {
      locationRoute,
      clearSelected,
    };
  },
});
</script>

<template>
  <v-tabs
    dense
    right
    class="px-4"
    @change="clearSelected"
  >
    <v-tab :to="locationRoute">
      <v-icon class="mr-2">
        mdi-folder-multiple
      </v-icon>
      Browse Data
    </v-tab>
    <v-tab :to="{ name: 'shared' }">
      <v-tooltip
        bottom
        open-delay="200"
        max-width="320"
      >
        <template #activator="{ on, attrs }">
          <span
            class="d-inline-flex align-center"
            v-bind="attrs"
            v-on="on"
          >
            <v-icon class="tab-icon">
              mdi-share-variant
            </v-icon>
            Shared with Me
          </span>
        </template>
        <span>
          Private datasets another user shared with you through access control.
          Public datasets editable by all users are not listed here.
        </span>
      </v-tooltip>
    </v-tab>
    <v-tab :to="{ name: 'summary' }">
      <v-icon class="tab-icon">
        mdi-tag
      </v-icon>
      Label summaries
    </v-tab>
  </v-tabs>
</template>

<style scoped>
.tab-icon {
  width: 28px;
  margin-right: 10px;
}
</style>
