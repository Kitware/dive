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

  setup(props, { emit }) {
    const showDetectionView = ref(true);
    const showEventView = ref(false);

    function toggleView(type: string) {
      if (!showDetectionView.value && !showEventView.value) {
        emit('resize');
      }
      if (type === 'Detection') {
        showDetectionView.value = !showDetectionView.value;
        showEventView.value = false;
      } else if (type === 'Event') {
        showEventView.value = !showEventView.value;
        showDetectionView.value = false;
      }
      if (!showDetectionView.value && !showEventView.value) {
        emit('resize');
      }
    }
    return {
      showDetectionView,
      showEventView,
      toggleView,
    };
  },
});
</script>

<template>
  <div>
    <Controls />
    <div class="timeline-buttons">
      <v-btn
        :outlined="showDetectionView"
        x-small
        class="toggle-timeline-button-detection"
        tab-index="-1"
        @click="toggleView('Detection')"
      >
        Detection
      </v-btn>
      <v-btn
        :outlined="showEventView"
        x-small
        class="toggle-timeline-button-event"
        tab-index="-1"
        @click="toggleView('Event')"
      >
        Events
      </v-btn>
    </div>
    <timeline-wrapper v-if="(showDetectionView || showEventView)">
      <template #default="{ maxFrame, frame, seek }">
        <Timeline
          :max-frame="maxFrame"
          :frame="frame"
          :display="(showDetectionView || showEventView)"
          @seek="seek"
        >
          <template
            #child="{
              startFrame,
              endFrame,
              maxFrame: childMaxFrame,
              clientWidth,
              clientHeight,
              margin,
            }"
          >
            <line-chart
              v-if="showDetectionView"
              :start-frame="startFrame"
              :end-frame="endFrame"
              :max-frame="childMaxFrame"
              :data="lineChartData.value"
              :client-width="clientWidth"
              :client-height="clientHeight"
              :margin="margin"
            />
            <event-chart
              v-if="showEventView"
              :start-frame="startFrame"
              :end-frame="endFrame"
              :max-frame="childMaxFrame"
              :data="eventChartData.value"
              :client-width="clientWidth"
              :margin="margin"
            />
          </template>
        </Timeline>
      </template>
    </timeline-wrapper>
  </div>
</template>

<style scoped>
.timeline-buttons{
  position:relative;
  top:-24px;
  margin-bottom:-24px;
}
</style>
