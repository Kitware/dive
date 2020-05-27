<script lang="ts">
/* eslint-disable*/
import {
  computed,
  defineComponent,
  ref,
  Ref,
  inject,
  provide,
  InjectionKey,
} from '@vue/composition-api';

// import store from '@/store';

import {
  useFeaturePointing,
  useGirderDataset,
  useLineChart,
  useSave,
  useStyling,
  useTrackFilters,
  useTrackSelectionControls,
  useTrackStore,
  useEventChart,
} from '@/use';

import ControlsContainer from './ControlsContainer.vue';
import Sidebar from './Sidebar.vue';
import components from './components';
import ImageAnnotator  from "@/components/annotators/ImageAnnotator.vue"
import Layers from '@/components/layers/Layers.vue';
import { getPathFromLocation } from '@/utils';
import store from '@/store';

export default defineComponent({
  components: {
    ControlsContainer,
    Sidebar,
    Layers,
    ...components,
  },

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
    
    const vuetify = inject('vuetify');

    // TODO p3: eventually we will have to migrate away from this style
    // and use the new plugin pattern:
    // https://vue-composition-api-rfc.netlify.com/#plugin-development
    const prompt = ctx.root.$prompt;

    // external composition functions
    const { typeColorMapper, stateStyling } = useStyling();
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
      trackMap,
      sortedTrackIds,
      intervalTree,
      addTrack,
      removeTrack: tsRemoveTrack,
      splitTracks,
      loadTracks,
    } = useTrackStore({ markChangesPending });

    const {
      checkedTrackIds,
      checkedTypes,
      confidenceThreshold,
      allTypes,
      filteredTrackIds,
      enabledTrackIds,
    } = useTrackFilters({ trackMap, sortedTrackIds });

  
    // Initialize the view
    Promise.all([
      loadDataset(datasetId),
      loadTracks(datasetId),
    ]).catch((err) => {
      // TODO p2: alert on errors...
      console.error(err);
    });

    const {
      selectedTrackId,
      setTrackEditMode,
      editingTrack,
      selectNextTrack,
      removeTrack, // override removeTrack
    } = useTrackSelectionControls({
      trackIds: filteredTrackIds,
      removeTrack: tsRemoveTrack,
    });

    const {
      featurePointing,
      featurePointingTarget,
      toggleFeaturePointing,
      featurePointed,
      deleteFeaturePoints,
    } = useFeaturePointing({ selectedTrackId, trackMap });

    const { lineChartData } = useLineChart({
      enabledTrackIds, typeColorMapper, allTypes, trackMap,
    });

    const { eventChartData } = useEventChart({
      enabledTrackIds, selectedTrackId, typeColorMapper, trackMap,
    });

    const location = computed(() => store.state.location);

    function handleClick(data:string, edit:boolean = false) {
      setTrackEditMode(data, edit);
    } 

    return {
      handleClick,
      dataset,
      confidence:confidenceThreshold,
      location,
      getPathFromLocation,
      pendingSaveCount,
      controlsContainerProps: {
        lineChartData,
        eventChartData,
      },
      sidebarProps: {
        trackMap,
        filteredTrackIds,
        allTypes,
        checkedTypes,
        checkedTrackIds,
        selectedTrackId,
        editingTrack,
        typeColorMapper,
        removeTrack,
        addTrack,
        selectNextTrack,
      },
      layerProps:{
        trackMap,
        filteredTrackIds,
        selectedTrackId,
        editingTrack,
        typeColorMapper,
        stateStyling,
        intervalTree,
        featurePointing,
        featurePointingTarget,   
      },
      playbackProps:{
      imageUrls,
      videoUrl,
      annotatorType,
      frameRate,
      },
      filteredTrackIds,
      allTypes,
      checkedTrackIds,
      checkedTypes,
      setTrackEditMode,
    };


    // const { markerData, markerStyle } = useMarkerLayer({ filteredDetections, selectedTrackId });

    // const { annotationData, annotationStyle } = useAnnotationLayer({
    //   typeColorMap,
    //   selectedTrackId,
    //   editingTrackId,
    //   filteredDetections,
    //   stateStyling,
    // });

    // const { textData, textStyle } = useTextLayer({
    //   typeColorMap,
    //   selectedTrackId,
    //   editingTrackId,
    //   filteredDetections,
    //   stateStyling,
    // });

    // const {
    //   addTrack,
    //   deleteTrack,
    //   detectionChanged,
    //   trackTypeChanged,
    // } = useEditingLayer({
    //   prompt,
    //   frame,
    //   detections,
    //   tracks,
    //   editingTrackId,
    //   editingDetection,
    //   setTrackEditMode,
    //   deleteDetection,
    //   setDetection,
    // });


    // function seek(_frame) {
    //   playbackComponent.value.seek(_frame);
    // }
    // function nextFrame() {
    //   playbackComponent.value.nextFrame();
    // }
    // function prevFrame() {
    //   playbackComponent.value.prevFrame();
    // }
    // function gotoTrackFirstFrame({ trackId }) {
    //   setTrackEditMode(trackId, false);
    //   const _frame = eventChartData.value.find((d) => d.track === trackId)
    //     .range[0];
    //   seek(_frame);
    // }
    // function annotationClick(data) {
    //   if (!featurePointing.value) {
    //     setTrackEditMode(data.detection.track, false);
    //   }
    // }
    // function annotationRightClick(data) {
    //   setTrackEditMode(data.detection.track);
    // }
    // function editTrack({ trackId }) {
    //   gotoTrackFirstFrame({ trackId });
    //   setTrackEditMode(trackId, true);
    // }
    // function save() {
    //   // If editing the track, disable editing mode before save
    //   if (editingDetection) {
    //     setTrackEditMode(selectedTrackId.value, false);
    //   }
    //   saveToGirder(datasetId, detections);
    // }



    // const editingBoxLayerStyle = {
    //   fill: false,
    //   strokeColor: vuetify.preset.theme.themes.dark.accent,
    // };

    // // Initialize the view
    // Promise.all([
    //   loadDataset(datasetId),
    //   loadDetections(datasetId),
    // ]).catch(() => ctx.root.$router.replace('/'));

    // const location = computed(() => store.state.location);

    // return {
    //   frame,
    //   showTrackView,
    //   typeColorMap,
    //   location,
    //   // Girder Dataset
    //   dataset,
    //   imageUrls,
    //   videoUrl,
    //   annotatorType,
    //   frameRate,
    //   // Selection Controls
    //   editingTrackId,
    //   editingDetectionGeojson,
    //   selectedTrack,
    //   selectedTrackId,
    //   selectedDetection,
    //   setTrackEditMode,
    //   selectNextTrack,
    //   selectPreviousTrack,
    //   // Save
    //   save,
    //   pendingSaveCount,
    //   // Track Filter Controls
    //   confidence,
    //   tracks,
    //   types,
    //   checkedTracks,
    //   checkedTypes,
    //   // Attribute Manager
    //   attributeEditing,
    //   attributeChange,
    //   // Detection module
    //   deleteDetection,
    //   // Editing layer
    //   addTrack,
    //   deleteTrack,
    //   trackTypeChanged,
    //   detectionChanged,
    //   // Head Tail Feature Layer Module
    //   toggleFeaturePointing,
    //   featurePointing,
    //   featurePointed,
    //   deleteFeaturePoints,
    //   // Annotation Layer Module
    //   annotationData,
    //   annotationStyle,
    //   // Text Layer
    //   textData,
    //   textStyle,
    //   // Marker Layer
    //   markerData,
    //   markerStyle,
    //   // Line Chart
    //   lineChartData,
    //   // Event Chart
    //   eventChartData,
    //   // local wrapper methods
    //   gotoTrackFirstFrame,
    //   editTrack,
    //   seek,
    //   nextFrame,
    //   prevFrame,
    //   annotationClick,
    //   annotationRightClick,
    //   // imported helper methods without side-effects
    //   getPathFromLocation,
    //   // miscellaneous oddities
    //   annotationRectEditor,
    //   editingBoxLayerStyle,
    //   playbackComponent,
    //   swapMousetrap,
    // };
  },
});
/* eslint-enable */
</script>

<template>
  <v-content
    class="viewer"
  >
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
        >
          <v-icon>mdi-content-save</v-icon>
        </v-btn>
      </v-badge>
    </v-app-bar>
    <v-row
      no-gutters
      class="fill-height"
    >
      <sidebar
        v-bind="sidebarProps"
      />

      <v-col style="position: relative; ">
        <component
          :is="playbackProps.annotatorType.value"
          v-if="playbackProps.imageUrls.value.length"
          ref="playbackComponent"
          :image-urls="playbackProps.imageUrls.value"
          :video-url="playbackProps.videoUrl.value"
          :frame-rate="playbackProps.frameRate.value"
          class="playback-component"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <controls-container v-bind="controlsContainerProps" />
          </template>
          <layers
            v-bind="layerProps"
            @selectTrack="handleClick"
          />
        </component>
      </v-col>
    </v-row>
    <!--  -->

    <!-- <v-app-bar app>
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
            { bind: 'q', handler: deleteFeaturePoints },
            { bind: 'esc', handler: () => setTrackEditMode(null, false)}
          ]"
          class="playback-component"
          :image-urls="imageUrls"
          :video-url="videoUrl"
          :frame-rate="frameRate"
          @frame-update="frame = $event"
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
                  <template
                    #child="{ startFrame, endFrame, maxFrame: childMaxFrame,
                              clientWidth, clientHeight}"
                  >
                    <line-chart
                      v-if="!showTrackView && lineChartData.length > 0"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="childMaxFrame"
                      :data="lineChartData"
                      :client-width="clientWidth"
                      :client-height="clientHeight"
                    />
                    <event-chart
                      v-if="showTrackView && eventChartData"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="childMaxFrame"
                      :data="eventChartData"
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
            @update:editing="setTrackEditMode(selectedTrackId, $event)"
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
    </v-row> -->
  </v-content>
</template>

<style lang="scss" scoped>
@import './viewer.scss';
</style>
