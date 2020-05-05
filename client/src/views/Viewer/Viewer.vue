<script>
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
  useEditingLayer,
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
    const annotationRectEditor = ref(null);
    const frame = ref(null); // the currently displayed frame number
    const showTrackView = ref(false);
    const vuetify = inject('vuetify');

    // TODO: eventually we will have to migrate away from this style
    // and use the new plugin pattern:
    // https://vue-composition-api-rfc.netlify.com/#plugin-development
    const prompt = ctx.root.$prompt;

    // external composition functions
    const { typeColorMap } = useTypeColoring();
    const { save: saveToGirder, markChangesPending, pendingSaveCount } = useSave();
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
      selectedDetectionIndex,
      selectedDetection,
      setTrackEditMode,
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
      deleteFeaturePoints,
    } = useFeaturePointing({
      selectedTrackId,
      selectedDetectionIndex,
      selectedDetection,
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

    const {
      addTrack,
      deleteTrack,
      detectionChanged,
      trackTypeChanged,
    } = useEditingLayer({
      prompt,
      frame,
      detections,
      tracks,
      editingTrackId,
      editingDetection,
      setTrackEditMode,
      deleteDetection,
      setDetection,
    });

    /**
     * Functions below are thin wrappers around other functions for use in the template.
     */
    function persistAnnotations() {
      // If there are on-screen annotations, persist them
      if (annotationRectEditor.value) {
        annotationRectEditor.value.persist();
      }
    }
    function seek(_frame) {
      playbackComponent.value.seek(_frame);
    }
    function nextFrame() {
      persistAnnotations();
      playbackComponent.value.nextFrame();
    }
    function prevFrame() {
      persistAnnotations();
      playbackComponent.value.prevFrame();
    }
    function handlePlayingStateChanged(newval) {
      if (newval) {
        persistAnnotations();
      }
    }
    function gotoTrackFirstFrame({ trackId }) {
      setTrackEditMode(trackId, false);
      const _frame = eventChartData.value.find((d) => d.track === trackId)
        .range[0];
      seek(_frame);
    }
    function annotationClick(data) {
      if (!featurePointing.value) {
        setTrackEditMode(data.detection.track, false);
      }
    }
    function annotationRightClick(data) {
      setTrackEditMode(data.detection.track);
    }
    function editTrack({ trackId }) {
      gotoTrackFirstFrame({ trackId });
      setTrackEditMode(trackId, true);
    }
    function save() {
      saveToGirder(datasetId, detections);
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
      setTrackEditMode,
      // Save
      save,
      pendingSaveCount,
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
      // Editing layer
      addTrack,
      deleteTrack,
      trackTypeChanged,
      detectionChanged,
      // Head Tail Feature Layer Module
      toggleFeaturePointing,
      featurePointing,
      featurePointed,
      deleteFeaturePoints,
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
      // local wrapper methods
      gotoTrackFirstFrame,
      editTrack,
      seek,
      nextFrame,
      prevFrame,
      annotationClick,
      annotationRightClick,
      // imported helper methods without side-effects
      getPathFromLocation,
      // miscellaneous oddities
      annotationRectEditor,
      editingBoxLayerStyle,
      handlePlayingStateChanged,
      playbackComponent,
      swapMousetrap,
    };
  },
});
</script>

<template>
  <v-content class="viewer">
    <v-app-bar app>
      <navigation-title />
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
      <user-guide-button annotating />
      <ConfidenceFilter :confidence.sync="confidence" />
      <v-badge
        overlap
        bottom
        :content="pendingSaveCount"
        :value="pendingSaveCount > 0"
        offset-x="14"
        offset-y="18"
      >
        <v-btn
          icon
          :disabled="pendingSaveCount === 0"
          @click="save"
        >
          <v-icon>mdi-content-save</v-icon>
        </v-btn>
      </v-badge>
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
            <type-list
              class="flex-grow-1"
              :types="types"
              :checked-types.sync="checkedTypes"
              :color-map="typeColorMap"
            />
            <v-divider />
            <tracks
              :tracks="tracks"
              :types="types"
              :checked-tracks.sync="checkedTracks"
              :selected-track-id="selectedTrackId"
              :editing-track-id="editingTrackId"
              class="flex-shrink-0"
              @goto-track-first-frame="gotoTrackFirstFrame"
              @edit-track="editTrack"
              @click-track="editTrack"
              @track-type-change="trackTypeChanged"
              @add-track="addTrack"
              @delete-track="deleteTrack"
            />
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
            { bind: 'q', handler: deleteFeaturePoints }
          ]"
          class="playback-component"
          :image-urls="imageUrls"
          :video-url="videoUrl"
          :frame-rate="frameRate"
          @frame-update="frame = $event"
          @playing-state-changed="handlePlayingStateChanged"
        >
          <template slot="control">
            <Controls />
            <timeline-wrapper>
              <template #default="{ maxFrame, frame, seek }">
                <Timeline
                  :max-frame="maxFrame"
                  :frame="frame"
                  @seek="seek"
                >
                  <template #child="{ startFrame, endFrame, maxFrame: childMaxFrame }">
                    <line-chart
                      v-if="!showTrackView && lineChartData.length > 0"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="childMaxFrame"
                      :data="lineChartData"
                    />
                    <event-chart
                      v-if="showTrackView && eventChartData"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="childMaxFrame"
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
            </timeline-wrapper>
          </template>
          <annotation-layer
            v-if="annotationData"
            :data="annotationData"
            :annotation-style="annotationStyle"
            @annotation-click="annotationClick"
            @annotation-right-click="annotationRightClick"
          />
          <edit-annotation-layer
            v-if="editingTrackId !== null && !playbackComponent.playing"
            ref="annotationRectEditor"
            editing="rectangle"
            :geojson="editingDetectionGeojson"
            :feature-style="editingBoxLayerStyle"
            @update:geojson="detectionChanged"
          />
          <edit-annotation-layer
            v-if="featurePointing"
            editing="point"
            @update:geojson="featurePointed"
          />
          <text-layer
            v-if="textData.length > 0"
            :data="textData"
            :text-style="textStyle"
          />
          <marker-layer
            v-if="markerData.length > 0"
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
                Add feature points, starting with head (g key)
              </v-list-item-title>
            </v-list-item>
            <v-list-item @click="toggleFeaturePointing('tail')">
              <v-list-item-title>
                Add feature points, starting with tail (t key)
              </v-list-item-title>
            </v-list-item>
            <v-list-item @click="deleteFeaturePoints">
              <v-list-item-title>
                Delete both feature points for current frame (q key)
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </v-col>
    </v-row>
  </v-content>
</template>

<style lang="scss" scoped>
@import './viewer.scss';
</style>
