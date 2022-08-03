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
    <ul>
      <li>
        Display the selected attributes numberical values in the timeline
        for the currently selected track.
      </li>
      <li>Click on the "Key Filter" Cog wheel to change which attributes to graph.</li>
      <li>
        The attributes graph button will be displayed near the "Detections" and
        "Events" button on the timeline.
      </li>
    </ul>
    <v-card-text>
      <v-row>
        <v-switch
          :value="timelineEnabled"
          label="Draw Timeline"
          @change="setTimelineEnabled"
        />
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
