<script lang="ts">
import {
  defineComponent, ref, PropType,
} from '@vue/composition-api';
import type { DatasetType } from 'dive-common/apispec';
import FileNameTimeDisplay from 'vue-media-annotator/components/controls/FileNameTimeDisplay.vue';
import { injectMediaController } from 'vue-media-annotator/components/annotators/useMediaController';
import {
  Controls,
  EventChart,
  LineChart,
  Timeline,
} from 'vue-media-annotator/components';


export default defineComponent({
  components: {
    Controls,
    EventChart,
    FileNameTimeDisplay,
    LineChart,
    Timeline,
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
    const {
      maxFrame, frame, seek, volume, setVolume,
    } = injectMediaController();

    return {
      currentView,
      toggleView,
      collapsed,
      maxFrame,
      frame,
      seek,
      volume,
      setVolume,
    };
  },
});
</script>

<template>
  <div>
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
        <file-name-time-display
          v-if="datasetType === 'image-sequence'"
          class="text-middle px-3"
          display-type="filename"
        />
        <span v-else-if="datasetType === 'video'">
          <span class="mr-2">
            <v-menu
              :close-on-content-click="false"
              top
              offset-y
              nudge-left="3"
              open-on-hover
              close-delay="500"
              open-delay="250"
              rounded="pill"
            >
              <template v-slot:activator="{ on }">
                <v-icon
                  @click="(!volume && setVolume(1)) || (volume && setVolume(0))"
                  v-on="on"
                > {{ volume === 0 ? 'mdi-volume-off' :'mdi-volume-medium' }}
                </v-icon>
              </template>
              <v-card style="overflow:hidden; width:30px">
                <v-slider
                  :value="volume"
                  min="0"
                  max="1.0"
                  step="0.05"
                  vertical
                  @change="setVolume"
                />
              </v-card>
            </v-menu>
          </span>
          <file-name-time-display
            class="text-middle"
            display-type="time"
          />
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
