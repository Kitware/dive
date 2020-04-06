<script>
import { defineComponent, ref } from '@vue/composition-api';

// Annotators
import VideoAnnotator from '@/components/annotators/VideoAnnotator.vue';
import ImageAnnotator from '@/components/annotators/ImageAnnotator.vue';
// Layers
import TextLayer from '@/components/layers/TextLayer.vue';
import MarkerLayer from '@/components/layers/MarkerLayer.vue';
import AnnotationLayer from '@/components/layers/AnnotationLayer.vue';
import EditAnnotationLayer from '@/components/layers/EditAnnotationLayer.vue';
// Controls
import Controls from '@/components/controls/Controls.vue';
import TimelineWrapper from '@/components/controls/TimelineWrapper.vue';
import Timeline from '@/components/controls/Timeline.vue';
import LineChart from '@/components/controls/LineChart.vue';
import EventChart from '@/components/controls/EventChart.vue';
// Other normal components
import NavigationTitle from '@/components/NavigationTitle.vue';
import ConfidenceFilter from '@/components/ConfidenceFilter.vue';
import Tracks from '@/components/Tracks.vue';
import TypeList from '@/components/TypeList.vue';
import AttributesPanel from '@/components/AttributesPanel.vue';
import {
  useAnnotationLayer,
  useDetections,
  useFeaturePointing,
  useGirderDataset,
  useSave,
  useSelectionControls,
  useTextLayer,
  useTrackFilterControls,
  useTypeColoring,
} from '@/use';

export default defineComponent({
  components: {
    NavigationTitle,
    VideoAnnotator,
    ImageAnnotator,
    Controls,
    AnnotationLayer,
    EditAnnotationLayer,
    TextLayer,
    MarkerLayer,
    Timeline,
    TimelineWrapper,
    ConfidenceFilter,
    Tracks,
    TypeList,
    AttributesPanel,
    LineChart,
    EventChart,
  },
  props: {
    datasetId: {
      type: String,
      required: true,
    },
  },
  setup(props, ctx) {
    const { datasetId } = props;
    const frame = ref(null); // the currently displayed frame number

    const { typeColorMap } = useTypeColoring();

    const { save, markChangesPending, pendingSave } = useSave();

    const {
      // dataset,
      frameRate,
      annotatorType,
      imageUrls,
      videoUrl,
      loadDataset,
    } = useGirderDataset();

    const {
      detections,
      loadDetections,
      setDetection,
      deleteDetection,
    } = useDetections({ markChangesPending });

    const {
      selectedTrackId,
      selectedDetection,
      selectTrack,
      setTrackEditMode,
      // deleteSelectedDetection
    } = useSelectionControls({
      frame,
      detections,
      deleteDetection,
    });

    const {
      featurePointing,
      toggleFeaturePointing,
      // featurePointed,
      // deleteFeaturePoints
    } = useFeaturePointing({
      detections,
      selectedDetection,
      selectedTrackId,
      setDetection,
    });

    const { filteredDetections } = useTrackFilterControls({ detections });

    const { annotationData, annotationStyle } = useAnnotationLayer({
      typeColorMap,
      selectedTrackId,
      filteredDetections,
    });

    const { textData, textStyle } = useTextLayer({
      typeColorMap,
      selectedTrackId,
      filteredDetections,
    });

    // Initialize the view
    Promise.all([
      loadDataset(datasetId),
      loadDetections(datasetId),
    ]).catch(() => ctx.root.$router.replace('/'));

    return {
      // data
      imageUrls,
      videoUrl,
      annotatorType,
      frameRate,
      frame,
      // Detection module
      deleteDetection,
      // Annotation Layer Module
      annotationData,
      annotationStyle,
      // Text Layer
      textData,
      textStyle,
      // Head Tail Feature Layer Module
      toggleFeaturePointing,
      // Other local methods
      annotationClick: (data) => !featurePointing.value && selectTrack(data.detection.track),
      annotationRightClick: (data) => setTrackEditMode(data.detection.track),
    };
  },
});
</script>

<template>
  <v-content class="viewer">
    <v-app-bar app>
      <NavigationTitle />
      <!-- <v-tabs icons-and-text hide-slider style="flex-basis:0; flex-grow:0;">
        <v-tab :to="getPathFromLocation(location)"
          >Data<v-icon>mdi-database</v-icon></v-tab
        >
      </v-tabs>
      <span class="subtitle-1 text-center" style="flex-grow: 1;">{{
        dataset ? dataset.name : ""
      }}</span>
      <user-guide-button />
      <ConfidenceFilter :confidence.sync="confidence" />
      <v-btn icon :disabled="!pendingSave" @click="save"
        ><v-icon>mdi-content-save</v-icon></v-btn
      > -->
    </v-app-bar>
    <v-row
      no-gutters
      class="fill-height"
    >
      <!-- <v-card width="300" style="z-index:1;">
        <v-btn
          icon
          class="swap-button"
          @click="attributeEditing = !attributeEditing"
          title="A key"
          v-mousetrap="[
            {
              bind: 'a',
              handler: () => {
                attributeEditing = !attributeEditing;
              }
            }
          ]"
          ><v-icon>mdi-swap-horizontal</v-icon></v-btn
        >
        <v-slide-x-transition>
          <div
            class="wrapper d-flex flex-column"
            v-if="!attributeEditing"
            key="type-tracks"
          >
            <TypeList
              class="flex-grow-1"
              :types="types"
              :checkedTypes.sync="checkedTypes"
              :colorMap="typeColorMap"
            />
            <v-divider />
            <Tracks
              :tracks="tracks"
              :types="types"
              :checked-tracks.sync="checkedTracks"
              :selected-track="selectedTrackId"
              :editing-track="editingTrack"
              class="flex-shrink-0"
              @goto-track-first-frame="gotoTrackFirstFrame"
              @delete-track="deleteTrack"
              @edit-track="editTrack($event.trackId)"
              @click-track="clickTrack"
              @add-track="addTrack"
              @track-type-change="trackTypeChange"
            />
          </div>
          <div v-else class="wrapper d-flex" key="attributes">
            <AttributesPanel
              :selectedDetection="selectedDetection"
              :selectedTrack="selectedTrack"
              @change="attributeChange"
            />
          </div>
        </v-slide-x-transition>
      </v-card> -->
      <v-col style="position: relative; ">
        <component
          :is="annotatorType"
          v-if="imageUrls.length || videoUrl"
          ref="playbackComponent"
          v-mousetrap="[
            { bind: 'g', handler: () => toggleFeaturePointing('head') },
            { bind: 'h', handler: () => toggleFeaturePointing('head') },
            { bind: 't', handler: () => toggleFeaturePointing('tail') },
            { bind: 'y', handler: () => toggleFeaturePointing('tail') },
            { bind: 'f', handler: () => $refs.playbackComponent.nextFrame() },
            { bind: 'd', handler: () => $refs.playbackComponent.prevFrame() },
            { bind: 'q', handler: deleteDetection }
          ]"
          class="playback-component"
          :image-urls="imageUrls"
          :video-url="videoUrl"
          :frame-rate="frameRate"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <Controls />
            <!-- <TimelineWrapper>
              <template #default="{maxFrame, frame, seek}">
                <Timeline :maxFrame="maxFrame" :frame="frame" :seek="seek">
                  <template #child="{startFrame, endFrame, maxFrame}">
                    <LineChart
                      v-if="!showTrackView && lineChartData"
                      :startFrame="startFrame"
                      :endFrame="endFrame"
                      :maxFrame="maxFrame"
                      :data="lineChartData"
                    />
                    <EventChart
                      v-if="showTrackView && eventChartData"
                      :startFrame="startFrame"
                      :endFrame="endFrame"
                      :maxFrame="maxFrame"
                      :data="eventChartData"
                    />
                  </template>
                  <v-btn
                    outlined
                    x-small
                    class="toggle-timeline-button"
                    @click="showTrackView = !showTrackView"
                    tabIndex="-1"
                  >
                    {{ showTrackView ? "Detection" : "Track" }}
                  </v-btn>
                </Timeline>
              </template>
            </TimelineWrapper> -->
          </template>
          <AnnotationLayer
            v-if="annotationData"
            :data="annotationData"
            :annotation-style="annotationStyle"
            @annotation-click="annotationClick"
            @annotation-right-click="annotationRightClick"
          />

          <!-- <EditAnnotationLayer
            v-if="editingTrack !== null"
            editing="rectangle"
            :geojson="editingDetectionGeojson"
            :feature-style="{
              fill: false,
              strokeColor: this.$vuetify.theme.themes.dark.accent
            }"
            @update:geojson="detectionChanged"
          />
          <EditAnnotationLayer
            v-if="featurePointing"
            editing="point"
            @update:geojson="featurePointed"
          /> -->
          <TextLayer
            v-if="textData"
            :data="textData"
            :text-style="textStyle"
          />
          <!-- <MarkerLayer
            v-if="markerData"
            :data="markerData"
            :markerStyle="markerStyle"
          /> -->
        </component>
        <!-- <v-menu offset-y v-if="selectedDetection">
          <template v-slot:activator="{ on }">
            <v-btn class="selection-menu-button" icon v-on="on">
              <v-icon>mdi-dots-horizontal</v-icon>
            </v-btn>
          </template>
          <v-list>
            <v-list-item @click="toggleFeaturePointing('head')">
              <v-list-item-title>
                Add feauture points, starting with head (g key)
              </v-list-item-title>
            </v-list-item>
            <v-list-item @click="toggleFeaturePointing('tail')">
              <v-list-item-title>
                Add feature points, starting with tail (t key)
              </v-list-item-title>
            </v-list-item>
            <v-list-item @click="deleteDetection">
              <v-list-item-title>
                Delete both feauture points for current frame (q key)
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu> -->
      </v-col>
    </v-row>
  </v-content>
</template>
