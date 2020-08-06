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
import TooltipBtn from '@/components/TooltipButton.vue';

export default defineComponent({
  components: {
    Controls,
    EventChart,
    LineChart,
    Timeline,
    TimelineWrapper,
    TooltipBtn,
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
    const currentView = ref('Detections');
    const collapsed = ref(false);

    /**
     * Toggles on and off the individual timeline views
     * Resizing is handled by the Annator itself.
     */
    function toggleView(type: 'Detections' | 'Events') {
      currentView.value = type;
      collapsed.value = false;
    }
    return {
      currentView,
      toggleView,
      collapsed,
    };
  },
});
</script>

<template>
  <div>
    <Controls />
    <div class="timeline-buttons">
      <tooltip-btn
        class="mx-2"
        :icon="collapsed?'mdi-chevron-up-box-outline': 'mdi-chevron-down-box-outline'"
        tooltip-text="Collapse/Expand Timeline"
        @click="collapsed=!collapsed"
      />
      <v-btn
        class="mx-2"
        :outlined="currentView==='Detections' && !collapsed"
        x-small
        tab-index="-1"
        @click="toggleView('Detections')"
      >
        Detections
      </v-btn>
      <v-btn
        class="mx-2"
        :outlined="currentView==='Events' && !collapsed"
        x-small
        tab-index="-1"
        @click="toggleView('Events')"
      >
        Events
      </v-btn>
    </div>
    <timeline-wrapper v-if="(!collapsed)">
      <template #default="{ maxFrame, frame, seek }">
        <Timeline
          :max-frame="maxFrame"
          :frame="frame"
          :display="!collapsed"
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
              v-if="currentView==='Detections'"
              :start-frame="startFrame"
              :end-frame="endFrame"
              :max-frame="childMaxFrame"
              :data="lineChartData.value"
              :client-width="clientWidth"
              :client-height="clientHeight"
              :margin="margin"
            />
            <event-chart
              v-if="currentView==='Events'"
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
  width: 250px;
}
</style>
