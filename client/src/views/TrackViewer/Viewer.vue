<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
} from '@vue/composition-api';


import store from '@/store';
import { getPathFromLocation } from '@/utils';
import { TrackId } from '@/lib/track';

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

interface Seeker {
  seek(frame: number): void;
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

  setup(props, ctx) {
    // TODO: eventually we will have to migrate away from this style
    // and use the new plugin pattern:
    // https://vue-composition-api-rfc.netlify.com/#plugin-development
    const prompt = ctx.root.$prompt;

    const { datasetId } = props;
    const playbackComponent = ref({} as Seeker);
    const frame = ref(0); // the currently displayed frame number
    const {
      save: saveToServer, markChangesPending, pendingSaveCount,
    } = useSave();

    const {
      typeStyling,
      stateStyling,
      updateTypeColor,
      loadTypeColors,
      saveTypeColors,
    } = useStyling({ markChangesPending });

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
      removeTrack: tsRemoveTrack,
      loadTracks,
    } = useTrackStore({ markChangesPending });

    const {
      checkedTrackIds,
      checkedTypes,
      confidenceThreshold,
      allTypes,
      filteredTrackIds,
      enabledTrackIds,
      updateTypeName,
    } = useTrackFilters({ trackMap, sortedTrackIds });

    Promise.all([
      loadDataset(datasetId),
      loadTracks(datasetId),
    ]).catch((err) => {
      // TODO p2: alert on errors...
      console.error(err);
      throw err;
    }).then(() => {
      // tasks to run after dataset and tracks have loaded
      loadTypeColors(dataset.value?.meta.customTypeColors);
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
      enabledTrackIds, typeStyling, allTypes, trackMap,
    });

    const { eventChartData } = useEventChart({
      enabledTrackIds, selectedTrackId, typeStyling, trackMap,
    });

    const location = computed(() => store.state.location);

    async function removeTrack(trackId: TrackId) {
      const result = await prompt({
        title: 'Confirm',
        text: 'Do you want to delete selected items?',
        confirm: true,
      });
      if (!result) {
        return;
      }
      // if removed track was selected, unselect before remove
      if (selectedTrackId.value === trackId) {
        const newTrack = selectNextTrack(1) !== null ? selectNextTrack(1) : selectNextTrack(-1);
        if (newTrack !== null) {
          selectTrack(newTrack, false);
        }
      }
      tsRemoveTrack(trackId);
    }

    function save() {
      // If editing the track, disable editing mode before save
      if (editingTrack.value) {
        selectTrack(selectedTrackId.value, false);
      }
      saveToServer(datasetId, trackMap);
      saveTypeColors(datasetId, allTypes);
    }

    function handleTrackTypeChange({ trackId, value }: { trackId: TrackId; value: string }) {
      getTrack(trackId).setType(value);
    }

    function handleTrackEdit(trackId: TrackId) {
      const track = getTrack(trackId);
      playbackComponent.value.seek(track.begin);
      selectTrack(trackId, true);
    }

    function handleTrackClick(trackId: TrackId) {
      const track = getTrack(trackId);
      playbackComponent.value.seek(track.begin);
      selectTrack(trackId, editingTrack.value);
    }

    function handleSelectNext(delta: number) {
      const newTrack = selectNextTrack(delta);
      if (newTrack !== null) {
        selectTrack(newTrack, false);
        const track = getTrack(newTrack);
        playbackComponent.value.seek(track.begin);
      }
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
      handleTrackClick,
      handleSelectNext,
      handleTrackEdit,
      handleTrackTypeChange,
      removeTrack,
      save,
      selectTrack,
      toggleFeaturePointing,
      featurePointed,
      updateTypeColor,
      updateTypeName,
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
        typeStyling,
      },
      layerProps: {
        trackMap,
        trackIds: enabledTrackIds,
        selectedTrackId,
        editingTrack,
        typeStyling,
        stateStyling,
        intervalTree,
        featurePointing,
        featurePointingTarget,
      },
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
        @track-add="selectTrack(addTrack(frame).trackId, true)"
        @track-remove="removeTrack"
        @track-click="handleTrackClick"
        @track-edit="handleTrackEdit"
        @track-next="handleSelectNext(1)"
        @track-previous="handleSelectNext(-1)"
        @track-type-change="handleTrackTypeChange($event)"
        @update-type-color="updateTypeColor($event)"
        @update-type-name="updateTypeName($event)"
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
            { bind: 'n', handler: () => selectTrack(addTrack(frame).trackId, true) },
            { bind: 't', handler: () => toggleFeaturePointing('tail') },
            { bind: 'y', handler: () => toggleFeaturePointing('tail') },
            { bind: 'q', handler: () => deleteFeaturePoints(frame) },
            { bind: 'esc', handler: () => selectTrack(null, false)}
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
            @selectTrack="selectTrack"
            @featurePointUpdated="featurePointed"
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
