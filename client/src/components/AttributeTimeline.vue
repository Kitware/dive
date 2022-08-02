<script lang="ts">
import {
  defineComponent,
} from '@vue/composition-api';

import AttributeKeyFilterVue from 'vue-media-annotator/components/AttributeFilter/AttributeKeyFilter.vue';
import { useAttributesFilters } from '../provides';
import TooltipBtn from './TooltipButton.vue';


/* Magic numbers involved in height calculation */

export default defineComponent({
  name: 'AttributeTimeline',

  props: {
    height: {
      type: Number,
      default: 200,
    },
    width: {
      type: Number,
      default: 300,
    },
  },

  components: {
    TooltipBtn,
    AttributeKeyFilter: AttributeKeyFilterVue,
  },

  setup() {
    const {
      setTimelineEnabled, setTimelineFilter, timelineFilter, timelineEnabled,
    } = useAttributesFilters();
    return {
      setTimelineEnabled,
      setTimelineFilter,
      timelineEnabled,
      timelineFilter,
    };
  },
});
</script>

<template>
  <v-card>
    <p>
      Activate selected track attribute timeline view.
      This will display the selected attributes numberical values in the timeline.
    </p>
    <v-card-text>
      <v-row>
        <v-checkbox
          :value="timelineEnabled"
          label="enabled"
          @change="setTimelineEnabled"
        />
        <span class="pl-1"> Enable Timeline </span>
      </v-row>
      <v-row>
        <attribute-key-filter
          :attribute-filter="timelineFilter"
          timeline
          @save-changes="setTimelineFilter($event)"
        />
      </v-row>
    </v-card-text>
  </v-card>
</template>

<style scoped lang='scss'>

.border-highlight {
   border-bottom: 1px solid gray;
 }

.type-checkbox {
  max-width: 80%;
  overflow-wrap: anywhere;
}

.hover-show-parent {
  .hover-show-child {
    display: none;
  }

  &:hover {
    .hover-show-child {
      display: inherit;
    }
  }
}
.outlined {
  background-color: gray;
  color: #222;
  font-weight: 600;
  border-radius: 6px;
  padding: 0 5px;
  font-size: 12px;
}
</style>
