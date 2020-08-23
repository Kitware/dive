<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
} from '@vue/composition-api';
import Track, { TrackId } from 'vue-media-annotator/track';
import {
  useLineChart,
  useStyling,
  useTrackFilters,
  useTrackSelectionControls,
  useTrackStore,
  useEventChart,
} from 'vue-media-annotator/use';
import VideoAnnotator from 'vue-media-annotator/components/annotators/VideoAnnotator.vue';
import ImageAnnotator from 'vue-media-annotator/components/annotators/ImageAnnotator.vue';
import LayerManager from 'vue-media-annotator/components/LayerManager.vue';

import { getDetections } from 'app/api/viameDetection.service';
import NavigationTitle from 'app/components/NavigationTitle.vue';
import EditorMenu from 'app/components/EditorMenu.vue';
import ConfidenceFilter from 'app/components/ConfidenceFilter.vue';
import UserGuideButton from 'app/components/UserGuideButton.vue';
import Export from 'app/components/Export.vue';
import RunPipelineMenu from 'app/components/RunPipelineMenu.vue';
import FeatureHandleControls from 'app/components/FeatureHandleControls.vue';
import { Seeker } from 'app/use/useModeManager';
import { getPathFromLocation } from 'app/utils';
import {
  useFeaturePointing,
  useGirderDataset,
  useModeManager,
  useSave,
  useSettings,
} from 'app/use';

import ControlsContainer from './ControlsContainer.vue';
import Sidebar from './Sidebar.vue';

export default defineComponent({
  components: {
    ControlsContainer,
    Export,
    FeatureHandleControls,
    Sidebar,
    LayerManager,
    VideoAnnotator,
    ImageAnnotator,
    NavigationTitle,
    ConfidenceFilter,
    RunPipelineMenu,
    UserGuideButton,
    EditorMenu,
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
      updateTypeStyle,
      populateTypeStyles,
      getTypeStyles,
    } = useStyling({ markChangesPending });

    const {
      dataset,
      frameRate,
      annotatorType,
      imageData,
      videoUrl,
      loadDataset,
    } = useGirderDataset();

    const {
      trackMap,
      sortedTracks,
      intervalTree,
      addTrack,
      insertTrack,
      getTrack,
      removeTrack,
      getNewTrackId,
      removeTrack: tsRemoveTrack,
    } = useTrackStore({ markChangesPending });

    async function loadTracks(datasetFolderId: string) {
      const data = await getDetections(datasetFolderId, 'track_json');
      if (data !== null) {
        Object.values(data).forEach(
          (trackData) => insertTrack(Track.fromJSON(trackData)),
        );
      }
    }

    const {
      checkedTrackIds,
      checkedTypes,
      confidenceThreshold,
      confidenceFilters,
      allTypes,
      filteredTracks,
      enabledTracks,
      populateConfidenceFilters,
      updateTypeName,
    } = useTrackFilters({ sortedTracks });

    Promise.all([
      loadDataset(datasetId),
      loadTracks(datasetId),
    ]).then(([ds]) => {
      // tasks to run after dataset and tracks have loaded
      populateTypeStyles(ds.meta.customTypeStyling);
      populateConfidenceFilters(ds.meta.confidenceFilters);
      ctx.root.$store.commit('Location/setLocation', {
        _id: ds.parentId,
        _modelType: ds.parentCollection,
      });
    });

    const {
      selectedTrackId,
      selectTrack,
      editingTrack,
      selectNextTrack,
    } = useTrackSelectionControls({
      tracks: filteredTracks,
    });

    const {
      featurePointing,
      featurePointingTarget,
      toggleFeaturePointing,
      featurePointed,
      deleteFeaturePoints,
    } = useFeaturePointing({ selectedTrackId, trackMap });

    const { lineChartData } = useLineChart({
      enabledTracks, typeStyling, allTypes,
    });

    const { eventChartData } = useEventChart({
      enabledTracks, selectedTrackId, typeStyling,
    });

    const { clientSettings, updateNewTrackSettings } = useSettings(allTypes);

    // Provides wrappers for actions to integrate with settings
    const {
      selectedFeatureHandle,
      handler,
      editingMode,
      visibleModes,
    } = useModeManager({
      selectedTrackId,
      editingTrack,
      frame,
      trackMap,
      playbackComponent,
      newTrackSettings: clientSettings.newTrackSettings.value,
      selectTrack,
      getTrack,
      selectNextTrack,
      addTrack,
      removeTrack,
    });


    async function splitTracks(trackId: TrackId | undefined, _frame: number) {
      if (typeof trackId === 'number') {
        const track = getTrack(trackId);
        let newtracks: [Track, Track];
        try {
          newtracks = track.split(_frame, getNewTrackId(), getNewTrackId() + 1);
        } catch (err) {
          await prompt({
            title: 'Error while splitting track',
            text: err,
            positiveButton: 'OK',
          });
          return;
        }
        const result = await prompt({
          title: 'Confirm',
          text: 'Do you want to split the selected track?',
          confirm: true,
        });
        if (!result) {
          return;
        }
        const wasEditing = editingTrack.value;
        selectTrack(null);
        tsRemoveTrack(trackId);
        insertTrack(newtracks[0]);
        insertTrack(newtracks[1]);
        selectTrack(newtracks[1].trackId, wasEditing);
      }
    }

    function save() {
      // If editing the track, disable editing mode before save
      if (editingTrack.value) {
        selectTrack(selectedTrackId.value, false);
      }
      saveToServer(datasetId, trackMap, {
        customTypeStyling: getTypeStyles(allTypes),
      });
    }

    function saveThreshold() {
      markChangesPending('meta');
      saveToServer(datasetId, undefined, {
        confidenceFilters: confidenceFilters.value,
      });
    }

    const dataPath = computed(() => (
      getPathFromLocation(ctx.root.$store.state.Location.location)));

    return {
      /* props use locally */
      annotatorType,
      confidenceThreshold,
      dataset,
      frame,
      frameRate,
      getPathFromLocation,
      imageData,
      dataPath,
      pendingSaveCount,
      playbackComponent,
      selectedTrackId,
      videoUrl,
      /* methods used locally */
      addTrack,
      deleteFeaturePoints,
      featurePointed,
      markChangesPending,
      save,
      saveThreshold,
      selectTrack,
      splitTracks,
      toggleFeaturePointing,
      updateNewTrackSettings,
      updateTypeStyle,
      updateTypeName,
      handler,
      /* props for sub-components */
      controlsContainerProps: {
        lineChartData,
        eventChartData,
      },
      featureHandleControlsProps: {
        selectedFeatureHandle,
      },
      modeEditorProps: {
        editingMode,
        visibleModes,
        editingTrack,
      },
      sidebarProps: {
        trackMap,
        filteredTracks,
        frame,
        allTypes,
        checkedTypes,
        checkedTrackIds,
        selectedTrackId,
        editingTrack,
        newTrackSettings: clientSettings.newTrackSettings,
        typeStyling,
      },
      layerProps: {
        editingMode,
        featurePointing,
        featurePointingTarget,
        intervalTree,
        selectedTrackId,
        stateStyling,
        trackMap,
        tracks: enabledTracks,
        typeStyling,
        visibleModes,
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
        <v-tab :to="dataPath">
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
      <feature-handle-controls
        v-bind="featureHandleControlsProps"
        @delete-point="handler.removePoint"
        @delete-annotation="handler.removeAnnotation"
      />
      <editor-menu
        v-bind="modeEditorProps"
        class="shrink px-6"
        @set-annotaiton-state="handler.setAnnotationState"
      />
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
        @update-new-track-settings="updateNewTrackSettings($event)"
        @track-split="splitTracks($event, frame)"
        @track-seek="playbackComponent.seek($event)"
        @update-type-style="updateTypeStyle($event)"
        @update-type-name="updateTypeName($event)"
      >
        <ConfidenceFilter
          :confidence.sync="confidenceThreshold"
          @end="saveThreshold"
        />
      </sidebar>
      <v-col style="position: relative; ">
        <component
          :is="annotatorType"
          v-if="imageData.length || videoUrl"
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
          :image-data="imageData"
          :video-url="videoUrl"
          :frame-rate="frameRate"
          class="playback-component"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <controls-container v-bind="controlsContainerProps" />
          </template>
          <layer-manager
            v-bind="layerProps"
            @feature-point-updated="featurePointed"
            @select-track="handler.selectTrack"
            @select-feature-handle="handler.selectFeatureHandle"
            @update-rect-bounds="handler.updateRectBounds"
            @update-geojson="handler.updateGeoJSON"
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
