<script lang="ts">
import {
  defineComponent, ref, PropType,
} from '@vue/composition-api';
import type { DatasetType } from 'dive-common/apispec';
import type { ImageDataItem } from 'vue-media-annotator/components/annotators/ImageAnnotator.vue';

import {
  Controls,
  EventChart,
  LineChart,
  Timeline,
  TimelineWrapper,
} from 'vue-media-annotator/components';

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
      type: Array as PropType<unknown[]>,
      required: true,
    },
    eventChartData: {
      type: Object as PropType<unknown>,
      required: true,
    },
    datasetType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
    imageData: {
      type: Array as PropType<ImageDataItem[]>,
      default: () => [],
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
    <timeline-wrapper>
      <template #default="{ maxFrame, frame, seek }">
        <Controls>
          <template slot="timelineControls">
            <div style="min-width: 210px">
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
                class="ml-2"
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
                class="ml-2"
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
          <template #middle>
            <span
              v-if="datasetType === 'image-sequence'"
              class="text-middle px-3"
            >
              {{ imageData[frame].filename }}
            </span>
          </template>
        </Controls>
        <Timeline
          v-if="(!collapsed)"
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
              :data="lineChartData"
              :client-width="clientWidth"
              :client-height="clientHeight"
              :margin="margin"
            />
            <event-chart
              v-if="currentView==='Events'"
              :start-frame="startFrame"
              :end-frame="endFrame"
              :max-frame="childMaxFrame"
              :data="eventChartData"
              :client-width="clientWidth"
              :margin="margin"
              @select-track="$emit('select-track', $event)"
            />
          </template>
        </Timeline>
      </template>
    </timeline-wrapper>
  </div>
</template>

<style lang="scss" scoped>
.text-middle {
  vertical-align: baseline;
  font-family: monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: bold;
}
.timeline-button {
  border: thin solid transparent;
}
</style>
