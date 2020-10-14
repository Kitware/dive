<script lang="ts">
import { computed, defineComponent, ref } from '@vue/composition-api';

/* VUE MEDIA ANNOTATOR */
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

/* VIAME WEB COMMON */
import PolygonBase from 'viame-web-common/recipes/polygonbase';
import HeadTail from 'viame-web-common/recipes/headtail';
import NavigationTitle from 'viame-web-common/components/NavigationTitle.vue';
import EditorMenu from 'viame-web-common/components/EditorMenu.vue';
import ConfidenceFilter from 'viame-web-common/components/ConfidenceFilter.vue';
import UserGuideButton from 'viame-web-common/components/UserGuideButton.vue';
import Export from 'viame-web-common/components/Export.vue';
import RunPipelineMenu from 'viame-web-common/components/RunPipelineMenu.vue';
import DeleteControls from 'viame-web-common/components/DeleteControls.vue';
import ControlsContainer from 'viame-web-common/components/ControlsContainer.vue';
import Sidebar from 'viame-web-common/components/Sidebar.vue';
import { Annotator } from 'viame-web-common/use/useModeManager';
import { getPathFromLocation } from 'viame-web-common/utils';
import {
  useModeManager,
  useSave,
  useSettings,
} from 'viame-web-common/use';
import { useApi, useDatasetId } from 'viame-web-common/apispec';

interface FrameImage {
  url: string;
  filename: string;
}

/**
 * TODO: These props are subject to change.
 * They're based on some state that had to be refactored,
 * and exist as the minimal delta between was we had and what
 * we needed.  This does not represent the
 * ideal interface.
 */
interface ViewerProps {
  frameRate: number;
  annotatorType: 'VideoAnnotator' | 'ImageAnnotator';
  imageData: FrameImage[];
  videoUrl: string;
}

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

  // TODO: remove this in vue 3
  props: ['frameRate', 'annotatorType', 'imageData', 'videoUrl'],

  setup(props: ViewerProps, ctx) {
    // TODO: eventually we will have to migrate away from this style
    // and use the new plugin pattern:
    // https://vue-composition-api-rfc.netlify.com/#plugin-development
    const prompt = ctx.root.$prompt;
    const playbackComponent = ref({} as Annotator);
    const frame = ref(0); // the currently displayed frame number
    const { loadDetections, loadMetadata } = useApi();
    const datasetId = useDatasetId();

    const {
      save: saveToServer,
      markChangesPending,
      pendingSaveCount,
    } = useSave();

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

    async function loadTracks() {
      const data = await loadDetections(datasetId.value);
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
      updateCheckedTypes,
      updateCheckedTrackId,
    } = useTrackFilters({ sortedTracks });

    Promise.all([
      loadMetadata(datasetId.value),
      loadTracks(),
    ]).then(([meta]) => {
      // tasks to run after dataset and tracks have loaded
      populateTypeStyles(meta.customTypeStyling);
      populateConfidenceFilters(meta.confidenceFilters);
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

    async function trackSplit(trackId: TrackId | null, _frame: number) {
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
        handler.trackSelect(null);
        tsRemoveTrack(trackId);
        insertTrack(newtracks[0]);
        insertTrack(newtracks[1]);
        handler.trackSelect(newtracks[1].trackId, wasEditing);
      }
    }

    function save() {
      // If editing the track, disable editing mode before save
      if (editingTrack.value) {
        handler.trackSelect(selectedTrackId.value, false);
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

    const globalHandler = {
      ...handler,
      setCheckedTypes: updateCheckedTypes,
      trackSplit,
      trackEnable: updateCheckedTrackId,
      updateTypeName,
      updateTypeStyle,
    };

    provideAnnotator(
      allTypes,
      checkedTrackIds,
      checkedTypes,
      editingMode,
      enabledTracks,
      frame,
      globalHandler,
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
      confidenceThreshold,
      editingTrack,
      editingMode,
      eventChartData,
      frame,
      getPathFromLocation,
      lineChartData,
      newTrackSettings: clientSettings.newTrackSettings,
      pendingSaveCount,
      playbackComponent,
      recipes,
      selectedFeatureHandle,
      selectedTrackId,
      selectedKey,
      visibleModes,
      /* methods */
      handler: globalHandler,
      markChangesPending,
      save,
      saveThreshold,
      updateNewTrackSettings,
    };
  },
});
</script>

<template>
  <v-main class="viewer">
    <v-app-bar app>
      <navigation-title />
      <slot name="title" />
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
      <slot name="toolbar-right" />
      <span class="ml-2">
        <export />
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
        @update-new-track-settings="updateNewTrackSettings($event)"
        @track-seek="playbackComponent.seek($event)"
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
            { bind: 'n', handler: () => handler.trackAdd() },
            { bind: 'r', handler: () => playbackComponent.resetZoom() },
            { bind: 'esc', handler: () => handler.trackAbort() },
          ]"
          v-bind="{ imageData, videoUrl, frameRate }"
          class="playback-component"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <controls-container
              v-bind="{ lineChartData, eventChartData }"
              @select-track="handler.trackSelect"
            />
          </template>
          <layer-manager />
        </component>
      </v-col>
    </v-row>
  </v-main>
</template>
