<script lang="ts">
import {
  defineComponent, ref, PropType, Ref,
} from '@vue/composition-api';
import Controls from 'vue-media-annotator/components/controls/Controls.vue';
import TimelineWrapper from 'vue-media-annotator/components/controls/TimelineWrapper.vue';
import Timeline from 'vue-media-annotator/components/controls/Timeline.vue';
import LineChart from 'vue-media-annotator/components/controls/LineChart.vue';
import EventChart from 'vue-media-annotator/components/controls/EventChart.vue';

import TooltipBtn from 'app/components/TooltipButton.vue';

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
    <Controls>
      <template slot="timelineControls">
        <div>
          <v-tooltip
            open-delay="200"
            bottom
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
                @click="collapsed=!collapsed"
              >
                {{ collapsed?'mdi-chevron-up-box': 'mdi-chevron-down-box' }}
              </v-icon>
            </template>
            <span>Collapse/Expand Timeline</span>
          </v-tooltip>
          <v-btn
            class="mx-2"
            :class="{'timeline-button':currentView!=='Detections' || collapsed}"
            depressed
            :outlined="currentView==='Detections' && !collapsed"
            x-small
            tab-index="-1"
            @click="toggleView('Detections')"
          >
            Detections
          </v-btn>
          <v-btn
            class="mx-2"
            :class="{'timeline-button':currentView!=='Events' || collapsed}"
            depressed
            :outlined="currentView==='Events' && !collapsed"
            x-small
            tab-index="-1"
            @click="toggleView('Events')"
          >
            Events
          </v-btn>
        </div>
      </template>
    </Controls>
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

<style lang="scss" scoped>
.timeline-button {
    border: thin solid transparent;
}
</style>
