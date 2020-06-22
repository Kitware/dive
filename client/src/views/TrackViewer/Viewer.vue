<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
} from '@vue/composition-api';


import store from '@/store';
import { getPathFromLocation } from '@/utils';

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
  useModeManager,
} from '@/use';

import VideoAnnotator from '@/components/annotators/VideoAnnotator.vue';
import ImageAnnotator from '@/components/annotators/ImageAnnotator.vue';
import NavigationTitle from '@/components/NavigationTitle.vue';
import ConfidenceFilter from '@/components/ConfidenceFilter.vue';
import UserGuideButton from '@/components/UserGuideButton.vue';
import Export from '@/components/Export.vue';
import RunPipelineMenu from '@/components/RunPipelineMenu.vue';

import ControlsContainer from './ControlsContainer.vue';
import Layers from './Layers.vue';
import Sidebar from './Sidebar.vue';

export interface Seeker {
  seek(frame: number): void;
  nextFrame(): void;
}

export default defineComponent({
  components: {
    ControlsContainer,
    Export,
    Sidebar,
    Layers,
    VideoAnnotator,
    ImageAnnotator,
    NavigationTitle,
    ConfidenceFilter,
    RunPipelineMenu,
    UserGuideButton,
  },

  props: {
    datasetId: {
      type: String,
      required: true,
    },
  },

  setup(props) {
    const { datasetId } = props;
    const playbackComponent = ref({} as Seeker);
    const frame = ref(0); // the currently displayed frame number

    const { typeColorMapper, stateStyling } = useStyling();
    const {
      save: saveToServer, markChangesPending, pendingSaveCount,
    } = useSave();

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
      getTrack,
      removeTrack,
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
      selectTrack,
      editingTrack,
      selectNextTrack,
    } = useTrackSelectionControls({
      trackIds: filteredTrackIds,
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

    // Provides wrappers for actions to integrate with settings
    const { handler } = useModeManager({
      selectedTrackId,
      editingTrack,
      frame,
      trackMap,
      playbackComponent,
      selectTrack,
      getTrack,
      selectNextTrack,
      addTrack,
      removeTrack,
    });

    const location = computed(() => store.state.location);

    function save() {
      // If editing the track, disable editing mode before save
      if (editingTrack.value) {
        selectTrack(selectedTrackId.value, false);
      }
      saveToServer(datasetId, trackMap);
    }


    return {
      /* props use locally */
      annotatorType,
      confidenceThreshold,
      dataset,
      frame,
      frameRate,
      getPathFromLocation,
      imageUrls,
      location,
      pendingSaveCount,
      playbackComponent,
      selectedTrackId,
      videoUrl,
      /* methods used locally */
      addTrack,
      deleteFeaturePoints,
      save,
      selectTrack,
      toggleFeaturePointing,
      featurePointed,
      /* props for sub-components */
      controlsContainerProps: {
        lineChartData,
        eventChartData,
      },
      sidebarProps: {
        trackMap,
        filteredTrackIds,
        frame,
        allTypes,
        checkedTypes,
        checkedTrackIds,
        selectedTrackId,
        editingTrack,
        typeColorMapper,
      },
      layerProps: {
        trackMap,
        trackIds: enabledTrackIds,
        selectedTrackId,
        editingTrack,
        typeColorMapper,
        stateStyling,
        intervalTree,
        featurePointing,
        featurePointingTarget,
      },
      handler,
    };
  },
});
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
        v-if="dataset"
        class="title pl-3"
      >
        {{ dataset.name }}
      </span>
      <v-spacer />
      <run-pipeline-menu
        v-if="dataset"
        :selected="[dataset]"
      />
      <span class="ml-2">
        <export :folder-id="datasetId" />
      </span>
      <user-guide-button annotating />
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
      <sidebar
        v-bind="sidebarProps"
        @track-add="handler.addTrack(frame)"
        @track-remove="handler.removeTrack"
        @track-click="handler.trackClick"
        @track-edit="handler.trackEdit"
        @track-next="handler.selectNext(1)"
        @track-previous="handler.selectNext(-1)"
        @track-type-change="handler.trackTypeChange($event)"
        @new-track-settings="handler.updateNewTrackSettings($event)"
      >
        <ConfidenceFilter :confidence.sync="confidenceThreshold" />
      </sidebar>
      <v-col style="position: relative; ">
        <component
          :is="annotatorType"
          v-if="imageUrls.length || videoUrl"
          ref="playbackComponent"
          v-mousetrap="[
            { bind: 'g', handler: () => toggleFeaturePointing('head') },
            { bind: 'h', handler: () => toggleFeaturePointing('head') },
            { bind: 'n', handler: () => handler.addTrack(frame) },
            { bind: 't', handler: () => toggleFeaturePointing('tail') },
            { bind: 'y', handler: () => toggleFeaturePointing('tail') },
            { bind: 'q', handler: () => deleteFeaturePoints(frame) },
            { bind: 'esc', handler: () => handler.selectTrack(null, false)}
          ]"
          :image-urls="imageUrls"
          :video-url="videoUrl"
          :frame-rate="frameRate"
          class="playback-component"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <controls-container v-bind="controlsContainerProps" />
          </template>
          <layers
            v-bind="layerProps"
            @selectTrack="handler.selectTrack"
            @featurePointUpdated="featurePointed"
            @update-rect-bounds="handler.updateRectBounds"
          />
        </component>
        <v-menu
          v-if="selectedTrackId"
          class="z-index: 100;"
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
            <v-list-item @click="deleteFeaturePoints(frame)">
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
.selection-menu-button {
  position: absolute;
  right: 0;
  top: 0;
  z-index: 1;
}
</style>
