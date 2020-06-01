<script lang="ts">
import {
  defineComponent,
  ref,
  // eslint-disable-next-line no-unused-vars
  PropType,
  // eslint-disable-next-line no-unused-vars
  Ref,
} from '@vue/composition-api';

import Controls from '@/components/controls/Controls.vue';
import TimelineWrapper from '@/components/controls/TimelineWrapper.vue';
import Timeline from '@/components/controls/Timeline.vue';
import LineChart from '@/components/controls/LineChart.vue';
import EventChart from '@/components/controls/EventChart.vue';

export default defineComponent({
  components: {
    Controls,
    EventChart,
    LineChart,
    Timeline,
    TimelineWrapper,
  },

  props: {
    lineChartData: {
      type: Object as PropType<Ref<unknown>>,
      required: true,
    },
    eventChartData: {
      type: Object as PropType<Ref<unknown>>,
      required: true,
    },
  },

  setup() {
    return {
      showTrackView: ref(false),
    };
  },
});
</script>

<template>
  <div>
    <Controls />
    <timeline-wrapper>
      <template #default="{ maxFrame, frame, seek }">
        <Timeline
          :max-frame="maxFrame"
          :frame="frame"
          @seek="seek"
        >
          <template
            #child="{
              startFrame,
              endFrame,
              maxFrame: childMaxFrame,
              clientWidth,
              clientHeight,
            }"
          >
            <line-chart
              v-if="!showTrackView"
              :start-frame="startFrame"
              :end-frame="endFrame"
              :max-frame="childMaxFrame"
              :data="lineChartData.value"
              :client-width="clientWidth"
              :client-height="clientHeight"
            />
            <event-chart
              v-else
              :start-frame="startFrame"
              :end-frame="endFrame"
              :max-frame="childMaxFrame"
              :data="eventChartData.value"
              :client-width="clientWidth"
            />
          </template>
          <v-btn
            outlined
            x-small
            class="toggle-timeline-button"
            tab-index="-1"
            @click="showTrackView = !showTrackView"
          >
            {{ showTrackView ? "Detection" : "Track" }}
          </v-btn>
        </Timeline>
      </template>
    </timeline-wrapper>
  </div>
</template>

<style scoped>
.toggle-timeline-button {
  position: absolute;
  top: -24px;
  left: 2px;
}
</style>
