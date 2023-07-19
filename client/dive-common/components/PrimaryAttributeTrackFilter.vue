<script lang="ts">
/* eslint-disable max-len */
import {
  computed, defineComponent, PropType, ref,
} from '@vue/composition-api';
import { useTrackFilters } from 'vue-media-annotator/provides';
import AttributeTrackFilter from './AttributeTrackFilter.vue';

export default defineComponent({
  name: 'PrimaryAttributeTrackFilter',
  components: {
    AttributeTrackFilter,
  },
  props: {
    toggle: {
      type: Function as PropType<(name: string) => void>,
      required: true,
    },
  },
  setup() {
    const trackFilters = useTrackFilters();
    const expanded = ref(true);
    const primaryFilters = computed(() => {
      const filters: number[] = [];
      trackFilters.attributeFilters.value.forEach((item, index) => {
        if (item.primaryDisplay) {
          filters.push(index);
        }
      });
      return filters;
    });
    const count = computed(() => trackFilters.enabledFilters.value.filter((item) => item).length);
    return {
      primaryFilters,
      expanded,
      count,
    };
  },
});
</script>

<template>
  <div v-if="primaryFilters.length">
    <div id="AttributeFilters">
      <v-row
        dense
        class="mx-2 my-0.5"
      >
        <v-btn
          icon
          x-small
          class="mx-1"
          @click="expanded = !expanded"
        >
          <v-icon>{{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
        </v-btn>

        <b>Track Attribute Filters</b>
        <v-badge
          overlap
          bottom
          :color="primary"
          :content="count"
          offset-x="12"
          offset-y="21"
        >
          <div v-on="on">
            <v-btn
              small
              icon
            >
              <v-icon>mdi-filter</v-icon>
            </v-btn>
          </div>
        </v-badge>
        <v-spacer />
        <v-btn
          icon
          x-small
          @click="toggle('AttributeTrackFilters')"
        >
          <v-icon>mdi-cog</v-icon>
        </v-btn>
      </v-row>
    </div>
    <div v-if="expanded">
      <div
        v-for="item in primaryFilters"
        :key="`filter_${item}`"
        class="mx-2"
      >
        <attribute-track-filter
          :filter-index="item"
          class="attributeTrackFilter"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-text {
  font-size: 0.75em;
}
#AttributeFilters {
  border-bottom: 1px solid gray;
  border-top: 1px solid gray;
}
.attributeTrackFilter{
  border-bottom: 1px solid gray;
}
</style>
