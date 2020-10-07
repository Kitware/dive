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
import { provideAnnotator } from 'vue-media-annotator/provides';
import {
  ImageAnnotator,
  VideoAnnotator,
  LayerManager,
} from 'vue-media-annotator/components';

import PolygonBase from 'app/recipes/polygonbase';
import HeadTail from 'app/recipes/headtail';

import { getDetections } from 'app/api/viameDetection.service';
import NavigationTitle from 'app/components/NavigationTitle.vue';
import EditorMenu from 'app/components/EditorMenu.vue';
import ConfidenceFilter from 'app/components/ConfidenceFilter.vue';
import UserGuideButton from 'app/components/UserGuideButton.vue';
import Export from 'app/components/Export.vue';
import RunPipelineMenu from 'app/components/RunPipelineMenu.vue';
import DeleteControls from 'app/components/DeleteControls.vue';
import { Annotator } from 'app/use/useModeManager';
import { getPathFromLocation } from 'app/utils';
import {
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
    DeleteControls,
    Export,
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
  async beforeRouteLeave(to, from, next) {
    if (!await this.navigateAway()) {
      next(false);
    } else {
      next();
    }
  },
  beforeMount() {
    window.addEventListener('beforeunload', this.preventNav);
  },

  beforeDestroy() {
    window.removeEventListener('beforeunload', this.preventNav);
  },
  setup(props, ctx) {
    // TODO: eventually we will have to migrate away from this style
    // and use the new plugin pattern:
    // https://vue-composition-api-rfc.netlify.com/#plugin-development
    const prompt = ctx.root.$prompt;

    const { datasetId } = props;
    const playbackComponent = ref({} as Annotator);
    const frame = ref(0); // the currently displayed frame number
    const {
      save: saveToServer, markChangesPending, pendingSaveCount,
    } = useSave(datasetId);


    async function navigateAway() {
      let result = false;
      if (pendingSaveCount.value > 0) {
        result = await prompt({
          title: 'Save Items',
          text: 'There is unsaved data, would you like to continue anyways?',
          confirm: true,
        });
      }
      return result;
    }
    async function preventNav(event: BeforeUnloadEvent) {
      if (!pendingSaveCount.value) return;
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      event.returnValue = '';
    }
    const recipes = [
      new PolygonBase(),
      new HeadTail(),
    ];

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
      removeTypeTracks,
      updateCheckedTypes,
      updateCheckedTrackId,
    } = useTrackFilters({ sortedTracks, removeTrack });

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
      selectedKey,
    } = useModeManager({
      recipes,
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
        handler.selectTrack(null);
        tsRemoveTrack(trackId);
        insertTrack(newtracks[0]);
        insertTrack(newtracks[1]);
        handler.selectTrack(newtracks[1].trackId, wasEditing);
      }
    }

    function save() {
      // If editing the track, disable editing mode before save
      if (editingTrack.value) {
        handler.selectTrack(selectedTrackId.value, false);
      }
      saveToServer({
        customTypeStyling: getTypeStyles(allTypes),
      });
    }

    function saveThreshold() {
      saveToServer({
        confidenceFilters: confidenceFilters.value,
      });
    }

    const dataPath = computed(() => (
      getPathFromLocation(ctx.root.$store.state.Location.location)));

    provideAnnotator(
      allTypes,
      checkedTrackIds,
      checkedTypes,
      editingMode,
      enabledTracks,
      frame,
      intervalTree,
      trackMap,
      filteredTracks,
      typeStyling,
      selectedKey,
      selectedTrackId,
      stateStyling,
      visibleModes,
    );

    return {
      /* props */
      annotatorType,
      confidenceThreshold,
      dataPath,
      dataset,
      editingTrack,
      editingMode,
      eventChartData,
      frame,
      frameRate,
      getPathFromLocation,
      imageData,
      lineChartData,
      newTrackSettings: clientSettings.newTrackSettings,
      pendingSaveCount,
      playbackComponent,
      recipes,
      selectedFeatureHandle,
      selectedTrackId,
      selectedKey,
      videoUrl,
      visibleModes,
      /* methods */
      addTrack,
      handler,
      markChangesPending,
      save,
      saveThreshold,
      splitTracks,
      updateCheckedTrackId,
      updateCheckedTypes,
      updateNewTrackSettings,
      updateTypeStyle,
      updateTypeName,
      removeTypeTracks,
      // For Navigation Guarding
      navigateAway,
      preventNav,
    };
  },
});
</script>

<template>
  <v-main
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
        <v-tab to="/settings">
          Settings<v-icon>mdi-settings</v-icon>
        </v-tab>
      </v-tabs>
      <span
        v-if="dataset"
        class="title pl-3"
      >
        {{ dataset.name }}
      </span>
      <v-spacer />
      <template #extension>
        <span>Viewer/Edit Controls</span>
        <editor-menu
          v-bind="{ editingMode, visibleModes, editingTrack, recipes }"
          class="shrink px-6"
          @set-annotation-state="handler.setAnnotationState"
        />
        <delete-controls
          v-bind="{ editingMode, selectedFeatureHandle }"
          @delete-point="handler.removePoint"
          @delete-annotation="handler.removeAnnotation"
        />
        <v-spacer />
      </template>
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
      style="min-width: 700px;"
    >
      <sidebar
        v-bind="{ newTrackSettings }"
        @track-add="handler.addTrack"
        @track-remove="handler.removeTrack"
        @track-click="handler.trackClick"
        @track-checked="updateCheckedTrackId"
        @track-edit="handler.trackEdit"
        @track-next="handler.selectNext(1)"
        @track-previous="handler.selectNext(-1)"
        @track-type-change="handler.trackTypeChange($event)"
        @update-new-track-settings="updateNewTrackSettings($event)"
        @track-split="splitTracks($event, frame)"
        @track-seek="playbackComponent.seek($event)"
        @update-type-style="updateTypeStyle($event)"
        @update-type-name="updateTypeName($event)"
        @update-checked-types="updateCheckedTypes($event)"
        @delete-type-tracks="removeTypeTracks($event)"
      >
        <ConfidenceFilter
          :confidence.sync="confidenceThreshold"
          @end="saveThreshold"
        />
      </sidebar>
      <v-col style="position: relative">
        <component
          :is="annotatorType"
          v-if="imageData.length || videoUrl"
          ref="playbackComponent"
          v-mousetrap="[
            { bind: 'n', handler: () => handler.addTrack },
            { bind: 'r', handler: () => playbackComponent.resetZoom() },
            { bind: 'esc', handler: () => handler.selectTrack(null, false)}
          ]"
          v-bind="{ imageData, videoUrl, frameRate }"
          class="playback-component"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <controls-container
              v-bind="{ lineChartData, eventChartData }"
              @select-track="handler.selectTrack"
            />
          </template>
          <layer-manager
            @select-track="handler.selectTrack"
            @select-feature-handle="handler.selectFeatureHandle"
            @update-rect-bounds="handler.updateRectBounds"
            @update-geojson="handler.updateGeoJSON"
          />
        </component>
      </v-col>
    </v-row>
  </v-main>
</template>
