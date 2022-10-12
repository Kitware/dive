<script lang="ts">
import {
  defineComponent, ref, PropType, computed, watch,
} from '@vue/composition-api';
import type { DatasetType } from 'dive-common/apispec';
import FileNameTimeDisplay from 'vue-media-annotator/components/controls/FileNameTimeDisplay.vue';
import {
  Controls,
  EventChart,
  injectAggregateController,
  LineChart,
  Timeline,
} from 'vue-media-annotator/components';
import { useAttributesFilters, useCameraStore, useSelectedCamera } from '../../src/provides';

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
    groupChartData: {
      type: Object as PropType<unknown>,
      required: true,
    },
    datasetType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
    collapsed: {
      type: Boolean,
      default: false,
    },
  },
  setup(_, { emit }) {
    const currentView = ref('Detections');
    const ticks = ref([0.25, 0.5, 0.75, 1.0, 2.0, 4.0, 8.0]);
    const cameraStore = useCameraStore();
    const multiCam = ref(cameraStore.camMap.value.size > 1);
    const selectedCamera = useSelectedCamera();
    const hasGroups = computed(
      () => !!cameraStore.camMap.value.get(selectedCamera.value)?.groupStore.sorted.value.length,
    );
    const { timelineEnabled, attributeTimelineData } = useAttributesFilters();
    // Format the Attribute data if it is available
    const attributeData = computed(() => {
      if (timelineEnabled.value) {
        let startFrame = Infinity;
        let endFrame = -Infinity;
        attributeTimelineData.value.forEach((item) => {
          startFrame = Math.min(startFrame, item.minFrame);
          endFrame = Math.max(endFrame, item.maxFrame);
        });
        const timelineData = attributeTimelineData.value.map((item) => item.data);
        return {
          startFrame,
          endFrame,
          data: timelineData,
        };
      }
      return null;
    });
    /**
     * Toggles on and off the individual timeline views
     * Resizing is handled by the Annator itself.
     */
    function toggleView(type: 'Detections' | 'Events' | 'Groups' | 'Attributes') {
      currentView.value = type;
      emit('update:collapsed', false);
    }
    watch(timelineEnabled, () => {
      if (!timelineEnabled.value && currentView.value === 'Attributes') {
        toggleView('Events');
      }
    });
    const {
      maxFrame, frame, seek, volume, setVolume, setSpeed, speed,
    } = injectAggregateController().value;
    return {
      currentView,
      toggleView,
      maxFrame,
      multiCam,
      frame,
      seek,
      volume,
      setVolume,
      speed,
      setSpeed,
      ticks,
      hasGroups,
      attributeData,
      timelineEnabled,
    };
  },
});
</script>

<template>
  <v-col
    dense
    style="position:absolute; bottom: 0px; padding: 0px; margin:0px;"
  >
    <Controls>
      <template slot="timelineControls">
        <div style="min-width: 270px">
          <v-tooltip
            open-delay="200"
            bottom
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
                @click="$emit('update:collapsed', !collapsed)"
              >
                {{ collapsed?'mdi-chevron-up-box': 'mdi-chevron-down-box' }}
              </v-icon>
            </template>
            <span>Collapse/Expand Timeline</span>
          </v-tooltip>
          <v-btn
            class="ml-1"
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
            class="ml-1"
            :class="{'timeline-button':currentView!=='Events' || collapsed}"
            depressed
            :outlined="currentView==='Events' && !collapsed"
            x-small
            tab-index="-1"
            @click="toggleView('Events')"
          >
            Events
          </v-btn>
          <v-btn
            v-if="!multiCam && hasGroups"
            class="ml-1"
            :class="{'timeline-button':currentView!=='Groups' || collapsed}"
            depressed
            :outlined="currentView==='Groups' && !collapsed"
            x-small
            tab-index="-1"
            @click="toggleView('Groups')"
          >
            Groups
          </v-btn>
          <v-btn
            v-if="!multiCam && timelineEnabled"
            class="ml-1"
            :class="{'timeline-button':currentView!=='Attributes' || collapsed}"
            depressed
            :outlined="currentView==='Attributes' && !collapsed"
            x-small
            tab-index="-1"
            @click="toggleView('Attributes')"
          >
            Attributes
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
          <span class="mr-2">
            <v-menu
              :close-on-content-click="false"
              top
              offset-y
              nudge-left="3"
              open-on-hover
              close-delay="500"
              open-delay="250"
              rounded="lg"
            >
              <template v-slot:activator="{ on }">
                <v-badge
                  :value="speed != 1.0"
                  color="#0277bd88"
                  :content="`${speed}X`"
                  offset-y="5px"
                  overlap
                >
                  <v-icon
                    v-on="on"
                    @click="setSpeed(1)"
                  > mdi-speedometer
                  </v-icon>
                </v-badge>
              </template>
              <v-card style="overflow:hidden; width:90px;">
                <v-slider
                  :value="ticks.indexOf(speed)"
                  min="0"
                  max="6"
                  step="1"
                  :tick-labels="ticks"
                  ticks="always"
                  :tick-size="4"
                  style="font-size:0.75em;"
                  vertical
                  @change="setSpeed(ticks[$event])"
                />

              </v-card>
            </v-menu>
          </span>
          <file-name-time-display
            class="text-middle pl-2"
            display-type="time"
          />
        </span>
        <v-tooltip
          open-delay="200"
          bottom
        >
          <template #activator="{ on }">
            <v-icon
              small
              class="mx-2"
              v-on="on"
            >
              mdi-information
            </v-icon>
          </template>
          <span>
            annotation framerate may be downsampled.
            <br>
            frame numbers start at zero.
          </span>
        </v-tooltip>
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
        <event-chart
          v-if="currentView==='Groups'"
          :start-frame="startFrame"
          :end-frame="endFrame"
          :max-frame="childMaxFrame"
          :data="groupChartData"
          :client-width="clientWidth"
          :margin="margin"
          @select-track="$emit('select-group', $event)"
        />
        <line-chart
          v-if="currentView==='Attributes'"
          :start-frame="startFrame"
          :end-frame="endFrame"
          :max-frame="endFrame"
          :data="attributeData.data"
          :client-width="clientWidth"
          :client-height="clientHeight"
          :margin="margin"
          :atrributes-chart="true"
        />
      </template>
    </Timeline>
  </v-col>
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
