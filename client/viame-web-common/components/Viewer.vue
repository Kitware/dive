<script lang="ts">
import {
  defineComponent, ref, PropType, toRef,
} from '@vue/composition-api';

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
import RunPipelineMenu from 'viame-web-common/components/RunPipelineMenu.vue';
import DeleteControls from 'viame-web-common/components/DeleteControls.vue';
import ControlsContainer from 'viame-web-common/components/ControlsContainer.vue';
import Sidebar from 'viame-web-common/components/Sidebar.vue';
import { Annotator } from 'viame-web-common/use/useModeManager';
import {
  useModeManager,
  useSave,
  useSettings,
} from 'viame-web-common/use';
import { useApi } from 'viame-web-common/apispec';

interface FrameImage {
  url: string;
  filename: string;
}

export default defineComponent({
  components: {
    ControlsContainer,
    DeleteControls,
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
  props: {
    datasetId: {
      type: String,
      required: true,
    },
    frameRate: {
      type: Number,
      required: true,
    },
    annotatorType: {
      type: String as PropType<'VideoAnnotator' | 'ImageAnnotator' | ''>,
      required: true,
    },
    imageData: {
      type: Array as PropType<FrameImage[]>,
      required: true,
    },
    videoUrl: {
      type: String,
      required: true,
    },
  },
  setup(props, ctx) {
    // TODO: eventually we will have to migrate away from this style
    // and use the new plugin pattern:
    // https://vue-composition-api-rfc.netlify.com/#plugin-development
    const prompt = ctx.root.$prompt;
    const playbackComponent = ref({} as Annotator);
    const frame = ref(0); // the currently displayed frame number
    const { loadDetections, loadMetadata } = useApi();
    // Loaded flag prevents annotator window from populating
    // with stale data from props, for example if a persistent store
    // like vuex is used to drive them.
    const loaded = ref(false);

    const {
      save: saveToServer,
      markChangesPending,
      pendingSaveCount,
    } = useSave(toRef(props, 'datasetId'));

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

    async function loadTracks(datasetId: string) {
      const data = await loadDetections(datasetId);
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
      importTypes,
      usedTypes,
      filteredTracks,
      enabledTracks,
      populateConfidenceFilters,
      updateTypeName,
      removeTypeTracks,
      deleteType,
      updateCheckedTypes,
      updateCheckedTrackId,
    } = useTrackFilters({ sortedTracks, removeTrack });

    Promise.all([
      loadMetadata(props.datasetId),
      loadTracks(props.datasetId),
    ]).then(([meta]) => {
      // tasks to run after dataset and tracks have loaded
      populateTypeStyles(meta.customTypeStyling);
      populateConfidenceFilters(meta.confidenceFilters);
      loaded.value = true;
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

    const { clientSettings, updateNewTrackSettings, updateTypeSettings } = useSettings(allTypes);

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

    async function save() {
      // If editing the track, disable editing mode before save
      if (editingTrack.value) {
        handler.trackSelect(selectedTrackId.value, false);
      }
      try {
        await saveToServer({
          customTypeStyling: getTypeStyles(allTypes),
        });
      } catch (err) {
        let text = 'Unable to Save Data';
        if (err.response && err.response.status === 403) {
          text = 'You do not have permission to Save Data to this Folder.';
        }
        await prompt({
          title: 'Error while Saving Data',
          text,
          positiveButton: 'OK',
        });
      }
    }

    function saveThreshold() {
      saveToServer({
        confidenceFilters: confidenceFilters.value,
      });
    }

    // Navigation Guards used by parent component
    async function warnBrowserExit(event: BeforeUnloadEvent) {
      if (pendingSaveCount.value === 0) return;
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      event.returnValue = '';
    }
    async function navigateAwayGuard(): Promise<boolean> {
      let result = true;
      if (pendingSaveCount.value > 0) {
        result = await prompt({
          title: 'Save Items',
          text: 'There is unsaved data, what would you like to do?',
          positiveButton: 'Save',
          negativeButton: 'Discard',
          confirm: true,
        });
        if (result) {
          await save();
        }
      }
      return result;
    }

    const globalHandler = {
      ...handler,
      setCheckedTypes: updateCheckedTypes,
      trackSplit,
      trackEnable: updateCheckedTrackId,
      updateTypeName,
      updateTypeStyle,
      removeTypeTracks,
      deleteType,
    };

    provideAnnotator(
      allTypes,
      usedTypes,
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
      lineChartData,
      loaded,
      newTrackSettings: clientSettings.newTrackSettings,
      typeSettings: clientSettings.typeSettings,
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
      updateTypeSettings,
      updateTypeStyle,
      updateTypeName,
      removeTypeTracks,
      importTypes,
      // For Navigation Guarding
      navigateAwayGuard,
      warnBrowserExit,
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
      <slot name="title-right" />
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
        v-bind="{ newTrackSettings, typeSettings }"
        @update-new-track-settings="updateNewTrackSettings($event)"
        @update-type-settings="updateTypeSettings($event)"
        @import-types="importTypes($event)"
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
          v-if="(imageData.length || videoUrl) && loaded"
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
