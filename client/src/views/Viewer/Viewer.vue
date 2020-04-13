<script>
import { mapState } from 'vuex';
import {
  defineComponent,
  ref,
  inject,
  computed,
} from '@vue/composition-api';

import store from '@/store';
import {
  useAnnotationLayer,
  useAttributeManager,
  useDetections,
  useEventChart,
  useFeaturePointing,
  useLineChart,
  useMarkerLayer,
  useGirderDataset,
  useSave,
  useSelectionControls,
  useTextLayer,
  useTrackFilterControls,
  useTypeColoring,
} from '@/use';
import { getPathFromLocation } from '@/utils';

import components from './components';

export default defineComponent({
  components,
  props: {
    datasetId: {
      type: String,
      required: true,
    },
  },
  setup(props, ctx) {
    const { datasetId } = props;
    const playbackComponent = ref(null);
    const frame = ref(null); // the currently displayed frame number
    const showTrackView = ref(false);
    const vuetify = inject('vuetify');
    // external composition functions
    const { typeColorMap } = useTypeColoring();
    const { save, markChangesPending, pendingSave } = useSave();
    const {
      dataset,
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
      confidence,
      filteredDetections,
      types,
      checkedTracks,
      checkedTypes,
      tracks,
    } = useTrackFilterControls({ detections });

    const {
      editingTrackId,
      editingDetection,
      editingDetectionGeojson,
      selectedTrack,
      selectedTrackId,
      selectedDetection,
      selectTrack,
      setTrackEditMode,
      // deleteSelectedDetection
    } = useSelectionControls({
      frame,
      detections,
      tracks,
      deleteDetection,
    });

    const {
      featurePointing,
      toggleFeaturePointing,
      featurePointed,
      // deleteFeaturePoints
    } = useFeaturePointing({
      detections,
      selectedDetection,
      selectedTrackId,
      setDetection,
    });

    const { attributeEditing, attributeChange } = useAttributeManager({
      detections,
      selectedTrack,
      selectedDetection,
      markChangesPending,
      setDetection,
    });

    const { markerData, markerStyle } = useMarkerLayer({ filteredDetections, selectedTrackId });
    const { lineChartData } = useLineChart({ filteredDetections, typeColorMap });
    const { eventChartData } = useEventChart({ filteredDetections, selectedTrackId, typeColorMap });

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

    /**
     * Functions below are thin wrappers around other functions for use in the template.
     */
    function seek(_frame) {
      playbackComponent.value.seek(_frame);
    }
    function nextFrame() {
      playbackComponent.value.nextFrame();
    }
    function prevFrame() {
      playbackComponent.value.prevFrame();
    }
    function gotoTrackFirstFrame(track) {
      selectTrack(track.trackId);
      const _frame = eventChartData.value.find((d) => d.track === track.trackId)
        .range[0];
      seek(_frame);
    }
    function annotationClick(data) {
      if (!featurePointing.value) {
        selectTrack(data.detection.track);
      }
    }
    function annotationRightClick(data) {
      setTrackEditMode(data.detection.track);
    }

    const swapMousetrap = [
      {
        bind: 'a',
        handler: () => { attributeEditing.value = !attributeEditing.value; },
      },
    ];

    const editingBoxLayerStyle = {
      fill: false,
      strokeColor: vuetify.preset.theme.themes.dark.accent,
    };

    // Initialize the view
    Promise.all([
      loadDataset(datasetId),
      loadDetections(datasetId),
    ]).catch(() => ctx.root.$router.replace('/'));

    const location = computed(() => store.state.location);

    return {
      frame,
      showTrackView,
      typeColorMap,
      location,
      // Girder Dataset
      dataset,
      imageUrls,
      videoUrl,
      annotatorType,
      frameRate,
      // Selection Controls
      editingTrackId,
      editingDetectionGeojson,
      selectedTrack,
      selectedTrackId,
      selectedDetection,
      selectTrack,
      // Save
      save,
      pendingSave,
      // Track Filter Controls
      confidence,
      tracks,
      types,
      checkedTracks,
      checkedTypes,
      // Attribute Manager
      attributeEditing,
      attributeChange,
      // Detection module
      deleteDetection,
      // Feature Pointing
      featurePointing,
      featurePointed,
      // Annotation Layer Module
      annotationData,
      annotationStyle,
      // Text Layer
      textData,
      textStyle,
      // Marker Layer
      markerData,
      markerStyle,
      // Line Chart
      lineChartData,
      // Event Chart
      eventChartData,
      // Head Tail Feature Layer Module
      toggleFeaturePointing,
      // local wrapper methods
      gotoTrackFirstFrame,
      seek,
      nextFrame,
      prevFrame,
      annotationClick,
      annotationRightClick,
      // imported helper methods without side-effects
      getPathFromLocation,
      // miscellaneous oddities
      playbackComponent,
      swapMousetrap,
      editingBoxLayerStyle,
    };
  },
});
</script>

<template>
  <v-content class="viewer">
    <v-app-bar app>
      <NavigationTitle />
      <v-tabs
        icons-and-text
        hide-slider
        style="flex-basis:0; flex-grow:0;"
      >
        <v-tab :to="getPathFromLocation(location)">
          Data
          <v-icon>mdi-database</v-icon>
        </v-tab>
      </v-tabs>
      <span
        class="subtitle-1 text-center"
        style="flex-grow: 1;"
      >
        {{ dataset ? dataset.name : "" }}
      </span>
      <user-guide-button />
      <ConfidenceFilter :confidence.sync="confidence" />
      <v-btn
        icon
        :disabled="!pendingSave"
        @click="save"
      >
        <v-icon>mdi-content-save</v-icon>
      </v-btn>
    </v-app-bar>
    <v-row
      no-gutters
      class="fill-height"
    >
      <v-card
        width="300"
        style="z-index:1;"
      >
        <v-btn
          v-mousetrap="swapMousetrap"
          icon
          title="A key"
          class="swap-button"
          @click="attributeEditing = !attributeEditing"
        >
          <v-icon>mdi-swap-horizontal</v-icon>
        </v-btn>
        <v-slide-x-transition>
          <div
            v-if="!attributeEditing"
            key="type-tracks"
            class="wrapper d-flex flex-column"
          >
            <TypeList
              class="flex-grow-1"
              :types="types"
              :checked-types.sync="checkedTypes"
              :color-map="typeColorMap"
            />
            <v-divider />
            <Tracks
              :tracks="tracks"
              :types="types"
              :checked-tracks.sync="checkedTracks"
              :selected-track-id="selectedTrackId"
              :editing-track-id="editingTrackId"
              class="flex-shrink-0"
              @goto-track-first-frame="gotoTrackFirstFrame"
              @edit-track="editingTrackId = $event.trackId"
              @click-track="track => selectTrack(track.trackId)"
            />
            <!-- @track-type-change="trackTypeChange" -->
            <!-- @add-track="addTrack" -->
            <!-- @delete-track="deleteTrack" -->
          </div>
          <div
            v-else
            key="attributes"
            class="wrapper d-flex"
          >
            <AttributesPanel
              :selected-detection="selectedDetection"
              :selected-track="selectedTrack"
              @change="attributeChange"
            />
          </div>
        </v-slide-x-transition>
      </v-card>
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
            { bind: 'f', handler: () => nextFrame() },
            { bind: 'd', handler: () => prevFrame() },
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
            <TimelineWrapper>
              <template #default="{maxFrame, frame, seek}">
                <Timeline
                  :max-frame="maxFrame"
                  :frame="frame"
                  :seek="seek"
                >
                  <template #child="{ startFrame, endFrame, maxFrame }">
                    <LineChart
                      v-if="!showTrackView && lineChartData"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="maxFrame"
                      :data="lineChartData"
                    />
                    <EventChart
                      v-if="showTrackView && eventChartData"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="maxFrame"
                      :data="eventChartData"
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
            </TimelineWrapper>
          </template>
          <AnnotationLayer
            v-if="annotationData"
            :data="annotationData"
            :annotation-style="annotationStyle"
            @annotation-click="annotationClick"
            @annotation-right-click="annotationRightClick"
          />
          <!-- @update:geojson="detectionChanged" -->
          <EditAnnotationLayer
            v-if="editingTrackId !== null"
            editing="rectangle"
            :geojson="editingDetectionGeojson"
            :feature-style="editingBoxLayerStyle"
          />
          <EditAnnotationLayer
            v-if="featurePointing"
            editing="point"
            @update:geojson="featurePointed"
          />
          <TextLayer
            v-if="textData"
            :data="textData"
            :text-style="textStyle"
          />
          <MarkerLayer
            v-if="markerData"
            :data="markerData"
            :marker-style="markerStyle"
          />
        </component>
        <v-menu
          v-if="selectedDetection"
          offset-y
        >
          <template v-slot:activator="{ on }">
            <v-btn
              class="selection-menu-button"
              icon
              v-on="on"
            >
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
        </v-menu>
      </v-col>
    </v-row>
  </v-content>
</template>
