<script lang="ts">
import {
  defineComponent, ref, toRef, computed, Ref, reactive, watch, onBeforeUnmount, nextTick,
} from '@vue/composition-api';
import type { Vue } from 'vue/types/vue';
import type { AxiosError } from 'axios';

/* VUE MEDIA ANNOTATOR */
import Track, { TrackId } from 'vue-media-annotator/track';
import {
  useAttributes,
  useImageEnhancements,
  useLineChart,
  useStyling,
  useTrackFilters,
  useTrackSelectionControls,
  useTrackStore,
  useTimeObserver,
  useEventChart,
} from 'vue-media-annotator/use';
import { useMediaController } from 'vue-media-annotator/components';
import { getAnyTrack, getPossibleTrack, getTrack } from 'vue-media-annotator/use/useTrackStore';
import { provideAnnotator } from 'vue-media-annotator/provides';
import ImageAnnotator from 'vue-media-annotator/components/annotators/ImageAnnotator.vue';
import VideoAnnotator from 'vue-media-annotator/components/annotators/VideoAnnotator.vue';
import LayerManager from 'vue-media-annotator/components/LayerManager.vue';

/* DIVE COMMON */

import PolygonBase from 'dive-common/recipes/polygonbase';
import HeadTail from 'dive-common/recipes/headtail';
import EditorMenu from 'dive-common/components/EditorMenu.vue';
import ConfidenceFilter from 'dive-common/components/ConfidenceFilter.vue';
import UserGuideButton from 'dive-common/components/UserGuideButton.vue';
import DeleteControls from 'dive-common/components/DeleteControls.vue';
import ControlsContainer from 'dive-common/components/ControlsContainer.vue';
import Sidebar from 'dive-common/components/Sidebar.vue';
import { useModeManager, useSave } from 'dive-common/use';
import clientSettingsSetup, { clientSettings } from 'dive-common/store/settings';
import { useApi, FrameImage, DatasetType } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { cloneDeep } from 'lodash';
import { getResponseError } from 'vue-media-annotator/utils';
import context from 'dive-common/store/context';

export interface ImageDataItem {
  url: string;
  filename: string;
}


export default defineComponent({
  components: {
    ControlsContainer,
    DeleteControls,
    ImageAnnotator,
    Sidebar,
    ConfidenceFilter,
    UserGuideButton,
    EditorMenu,
    VideoAnnotator,
    LayerManager,
  },

  // TODO: remove this in vue 3
  props: {
    id: {
      type: String,
      required: true,
    },
    revision: {
      type: Number,
      default: undefined,
    },
    readOnlyMode: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, ctx) {
    const { prompt } = usePrompt();
    const loadError = ref('');
    const baseMulticamDatasetId = ref(null as string | null);
    const datasetId = toRef(props, 'id');
    const multiCamList: Ref<string[]> = ref(['singleCam']);
    const defaultCamera = ref('singleCam');
    const selectedCamera = ref('singleCam');
    const playbackComponent = ref(undefined as Vue | undefined);
    const readonlyState = computed(() => props.readOnlyMode || props.revision !== undefined);
    const {
      aggregateController,
      onResize,
      clear: mediaControllerClear,
    } = useMediaController();
    const { time, updateTime, initialize: initTime } = useTimeObserver();
    const imageData = ref({ singleCam: [] } as Record<string, FrameImage[]>);
    const datasetType: Ref<DatasetType> = ref('image-sequence');
    const datasetName = ref('');
    const saveInProgress = ref(false);
    const videoUrl: Ref<Record<string, string>> = ref({});
    const { loadDetections, loadMetadata, saveMetadata } = useApi();
    const progress = reactive({
      // Loaded flag prevents annotator window from populating
      // with stale data from props, for example if a persistent store
      // like vuex is used to drive them.
      loaded: false,
      // Tracks loaded
      progress: 0,
      // Total tracks
      total: 0,
    });

    const progressValue = computed(() => {
      if (progress.total > 0 && (progress.progress !== progress.total)) {
        return Math.round((progress.progress / progress.total) * 100);
      }
      return 0;
    });


    const {
      save: saveToServer,
      markChangesPending,
      discardChanges,
      pendingSaveCount,
      addCamera: addSaveCamera,
    } = useSave(datasetId, readonlyState);

    const {
      imageEnhancements,
      brightness,
      intercept,
      setSVGFilters,
    } = useImageEnhancements();

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
      attributesList: attributes,
      loadAttributes,
      setAttribute,
      deleteAttribute,
    } = useAttributes({ markChangesPending });

    const {
      camMap,
      sortedTracks,
      intervalTree,
      addTrack,
      insertTrack,
      addCamera,
      removeCamera,
      removeTrack,
      getNewTrackId,
      removeTrack: tsRemoveTrack,
      clearAllTracks,
    } = useTrackStore({ markChangesPending });

    const {
      checkedTrackIds,
      checkedTypes,
      confidenceFilters,
      allTypes,
      importTypes,
      usedTypes,
      filteredTracks,
      enabledTracks,
      setConfidenceFilters,
      updateTypeName,
      removeTypeTracks,
      deleteType,
      updateCheckedTypes,
      updateCheckedTrackId,
    } = useTrackFilters({
      sortedTracks,
      removeTrack,
      markChangesPending,
      camMap,
    });

    const {
      selectedTrackId,
      selectTrack,
      editingTrack,
      selectNextTrack,
    } = useTrackSelectionControls({
      filteredTracks,
      readonlyState,
    });

    clientSettingsSetup(allTypes);

    // Provides wrappers for actions to integrate with settings
    const {
      mergeList,
      mergeInProgress,
      linkingTrack,
      linkingCamera,
      selectedFeatureHandle,
      handler,
      editingMode,
      editingDetails,
      visibleModes,
      selectedKey,
    } = useModeManager({
      recipes,
      selectedTrackId,
      selectedCamera,
      editingTrack,
      camMap,
      aggregateController,
      selectTrack,
      selectNextTrack,
      addTrack,
      removeTrack,
    });

    const allSelectedIds = computed(() => {
      const selected = selectedTrackId.value;
      if (selected !== null) {
        return mergeList.value.concat(selected);
      }
      return mergeList.value;
    });

    const { lineChartData } = useLineChart({
      enabledTracks, typeStyling, allTypes,
    });

    const { eventChartData } = useEventChart({
      enabledTracks, selectedTrackIds: allSelectedIds, typeStyling,
    });

    async function trackSplit(trackId: TrackId | null, frame: number) {
      if (typeof trackId === 'number') {
        const track = getTrack(camMap, trackId, selectedCamera.value);
        let newtracks: [Track, Track];
        try {
          newtracks = track.split(frame, getNewTrackId(), getNewTrackId() + 1);
        } catch (err) {
          await prompt({
            title: 'Error while splitting track',
            text: err as string,
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

    // Remove a track from within a camera multi-track into it's own track
    function unlinkCameraTrack(trackId: TrackId, camera: string) {
      const track = getTrack(camMap, trackId, camera);
      handler.trackSelect(null, false);

      const newTrack = Track.fromJSON({
        trackId: getNewTrackId(),
        meta: track.meta,
        begin: track.begin,
        end: track.end,
        features: track.features,
        confidencePairs: track.confidencePairs,
        attributes: track.attributes,
      });
      handler.removeTrack([trackId], true, camera);
      insertTrack(newTrack, { imported: false, cameraName: camera });
      handler.trackSelect(newTrack.trackId);
    }

    /**
     * Takes a BaseTrack and a merge Track and will attempt to merge the existing track
     * into the camera and baseTrack.
     * Requires that baseTrack doesn't have a track for the camera already
     * Also requires that the mergeTrack isn't a track across multiple cameras.
     */
    function linkCameraTrack(baseTrack: TrackId, linkTrack: TrackId, camera: string) {
      camMap.forEach((trackMap, key) => {
        if (trackMap.get(linkTrack) && key !== camera) {
          throw Error(`Attempting to link Track: ${linkTrack} to camera: ${camera} where there the track exists in another camera: ${key}`);
        }
      });
      const track = getTrack(camMap, linkTrack, camera);
      const selectedTrack = getAnyTrack(camMap, baseTrack);
      handler.removeTrack([linkTrack], true, camera);
      const newTrack = Track.fromJSON({
        trackId: baseTrack,
        meta: track.meta,
        begin: track.begin,
        end: track.end,
        features: track.features,
        confidencePairs: selectedTrack.confidencePairs,
        attributes: track.attributes,
      });
      insertTrack(newTrack, { imported: false, cameraName: camera });
    }

    watch(linkingTrack, () => {
      if (linkingTrack.value !== null && selectedTrackId.value !== null) {
        linkCameraTrack(selectedTrackId.value, linkingTrack.value, linkingCamera.value);
        handler.stopLinking();
      }
    });

    async function save() {
      // If editing the track, disable editing mode before save
      saveInProgress.value = true;
      if (editingTrack.value) {
        handler.trackSelect(selectedTrackId.value, false);
      }
      try {
        await saveToServer({
          customTypeStyling: getTypeStyles(allTypes),
          confidenceFilters: confidenceFilters.value,
        });
      } catch (err) {
        let text = 'Unable to Save Data';
        if (err.response?.status === 403) {
          text = 'You do not have permission to Save Data to this Folder.';
        }
        await prompt({
          title: 'Error while Saving Data',
          text,
          positiveButton: 'OK',
        });
        saveInProgress.value = false;
        throw err;
      }
      saveInProgress.value = false;
    }

    function saveThreshold() {
      saveMetadata(datasetId.value, {
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
          text: 'There is unsaved data, would you like to continue or cancel and save?',
          positiveButton: 'Discard and Leave',
          negativeButton: 'Don\'t Leave',
          confirm: true,
        });
      }
      return result;
    }


    const setSelectedCamera = async (camera: string, editMode = false) => {
      if (linkingCamera.value !== '' && linkingCamera.value !== camera) {
        await prompt({
          title: 'In Linking Mode',
          text: 'Currently in Linking Mode, please hit OK and Escape to exit Linking mode or choose another Track in the highlighted Camera to Link',
          positiveButton: 'OK',
        });
        return;
      }
      // EditTrack is set false by the LayerMap before executing this
      if (selectedTrackId.value !== null) {
        // If we had a track selected and it still exists with
        // a feature length of 0 we need to remove it
        const track = getPossibleTrack(camMap, selectedTrackId.value, selectedCamera.value);
        if (track && track.features.length === 0) {
          handler.trackAbort();
        }
      }
      selectedCamera.value = camera;
      /**
       * Enters edit mode if not track exists for the camera and forcing edit mode
       * or if a track exists and are alrady in edit mode we don't set it again
       * Remember trackEdit(number) is a toggle for editing mode
       */
      if (selectedTrackId.value !== null && (editMode || editingTrack.value)) {
        const track = getPossibleTrack(camMap, selectedTrackId.value, selectedCamera.value);
        if (track === undefined || !editingTrack.value) {
        //Stay in edit mode for the current track
          handler.trackEdit(selectedTrackId.value);
        }
      }
      ctx.emit('change-camera', camera);
    };

    // Handles changing camera using the dropdown or mouse clicks
    // When using mouse clicks and right button it will remain in edit mode for the selected track
    const changeCamera = (camera: string, event?: MouseEvent) => {
      if (selectedCamera.value === camera) {
        return;
      }
      if (event) {
        event.preventDefault();
      }
      // Left click should kick out of editing mode automatically
      if (event?.button === 0) {
        editingTrack.value = false;
      }
      setSelectedCamera(camera, event?.button === 2);
      ctx.emit('change-camera', camera);
    };
    /** Trigger data load */
    const loadData = async () => {
      try {
        const meta = await loadMetadata(datasetId.value);
        const defaultCameraMeta = meta.multiCamMedia?.cameras[meta.multiCamMedia.defaultDisplay];
        baseMulticamDatasetId.value = datasetId.value;
        if (defaultCameraMeta !== undefined && meta.multiCamMedia) {
          /* We're loading a multicamera dataset */
          const { cameras } = meta.multiCamMedia;
          multiCamList.value = Object.keys(cameras);
          defaultCamera.value = meta.multiCamMedia.defaultDisplay;
          changeCamera(defaultCamera.value);
          baseMulticamDatasetId.value = datasetId.value;
          if (!selectedCamera.value) {
            throw new Error('Multicamera dataset without default camera specified.');
          }
        }
        populateTypeStyles(meta.customTypeStyling);
        if (meta.customTypeStyling) {
          importTypes(Object.keys(meta.customTypeStyling), false);
        }
        if (meta.attributes) {
          loadAttributes(meta.attributes);
        }
        setConfidenceFilters(meta.confidenceFilters);
        datasetName.value = meta.name;
        initTime({
          frameRate: meta.fps,
          originalFps: meta.originalFps || null,
        });
        for (let i = 0; i < multiCamList.value.length; i += 1) {
          const camera = multiCamList.value[i];
          let cameraId = baseMulticamDatasetId.value;
          if (multiCamList.value.length > 1) {
            cameraId = `${baseMulticamDatasetId.value}/${camera}`;
          }
          // eslint-disable-next-line no-await-in-loop
          const subCameraMeta = await loadMetadata(cameraId);
          imageData.value[camera] = cloneDeep(subCameraMeta.imageData) as FrameImage[];
          if (subCameraMeta.videoUrl) {
            videoUrl.value[camera] = subCameraMeta.videoUrl;
          }
          addCamera(camera);
          addSaveCamera(camera);
          // eslint-disable-next-line no-await-in-loop
          const camTrackData = await loadDetections(cameraId);
          const camTracks = Object.values(camTrackData);
          progress.total = camTracks.length;
          for (let j = 0; j < camTracks.length; j += 1) {
            if (j % 4000 === 0) {
              /* Every N tracks, yeild some cycles for other scheduled tasks */
              progress.progress = j;
              // eslint-disable-next-line no-await-in-loop
              await new Promise((resolve) => window.setTimeout(resolve, 500));
            }
            insertTrack(Track.fromJSON(camTracks[j]), { imported: true, cameraName: camera });
          }
        }
        // Remove default cameras such as singleCam if they aren't in the camMap
        camMap.forEach((_cam, key) => {
          if (!multiCamList.value.includes(key)) {
            removeCamera(key);
          }
        });
        progress.loaded = true;
      } catch (err) {
        progress.loaded = false;
        console.error(err);
        const errorEl = document.createElement('div');
        errorEl.innerHTML = getResponseError(err as AxiosError);
        loadError.value = errorEl.innerText
          .concat(". If you don't know how to resolve this, please contact the server administrator.");
        throw err;
      }
    };
    loadData();

    const reloadAnnotations = async () => {
      mediaControllerClear();
      clearAllTracks();
      discardChanges();
      progress.loaded = false;
      await loadData();
    };

    watch(datasetId, reloadAnnotations);
    watch(readonlyState, () => selectTrack(null, false));

    const controlsRef = ref();
    const controlsHeight = ref(0);
    const controlsCollapsed = ref(false);
    function handleResize() {
      if (controlsRef.value) {
        controlsHeight.value = controlsRef.value.$el.clientHeight;
        onResize();
      }
    }
    const observer = new ResizeObserver(handleResize);
    /* On a reload this will watch the controls element and add on observer
     * so that once done loading the or if the controlsRef is collapsed it will resize all cameras
    */
    watch(controlsRef, (previous) => {
      if (previous) observer.unobserve(previous.$el);
      if (controlsRef.value) observer.observe(controlsRef.value.$el);
    });
    watch(controlsCollapsed, async () => {
      await nextTick();
      handleResize();
    });
    onBeforeUnmount(() => {
      if (controlsRef.value) observer.unobserve(controlsRef.value.$el);
    });

    const globalHandler = {
      ...handler,
      save,
      setCheckedTypes: updateCheckedTypes,
      trackSplit,
      trackEnable: updateCheckedTrackId,
      updateTypeName,
      updateTypeStyle,
      removeTypeTracks,
      deleteType,
      setAttribute,
      setConfidenceFilters,
      deleteAttribute,
      reloadAnnotations,
      setSelectedCamera,
      linkCameraTrack,
      unlinkCameraTrack,
      setSVGFilters,
    };

    provideAnnotator(
      {
        annotatorPreferences: toRef(clientSettings, 'annotatorPreferences'),
        attributes,
        allTypes,
        datasetId,
        usedTypes,
        checkedTrackIds,
        checkedTypes,
        confidenceFilters,
        editingMode,
        enabledTracks,
        intervalTree,
        mergeList,
        pendingSaveCount,
        camMap,
        progress,
        revisionId: toRef(props, 'revision'),
        filteredTracks,
        typeStyling,
        selectedKey,
        selectedTrackId,
        selectedCamera,
        stateStyles: stateStyling,
        time,
        visibleModes,
        readOnlyMode: readonlyState,
        imageEnhancements,
      },
      globalHandler,
    );

    return {
      /* props */
      aggregateController,
      confidenceFilters,
      clientSettings,
      controlsRef,
      controlsHeight,
      controlsCollapsed,
      datasetName,
      datasetType,
      editingTrack,
      editingMode,
      editingDetails,
      eventChartData,
      imageData,
      lineChartData,
      loadError,
      mergeMode: mergeInProgress,
      pendingSaveCount,
      progress,
      progressValue,
      saveInProgress,
      playbackComponent,
      recipes,
      selectedFeatureHandle,
      selectedTrackId,
      selectedKey,
      linkingCamera,
      videoUrl,
      visibleModes,
      frameRate: time.frameRate,
      originalFps: time.originalFps,
      context,
      readonlyState,
      brightness,
      intercept,
      /* methods */
      handler: globalHandler,
      save,
      saveThreshold,
      updateTime,
      updateTypeStyle,
      updateTypeName,
      removeTypeTracks,
      importTypes,
      // multicam
      multiCamList,
      defaultCamera,
      selectedCamera,
      changeCamera,
      // For Navigation Guarding
      navigateAwayGuard,
      warnBrowserExit,
      reloadAnnotations,
    };
  },
});
</script>

<template>
  <v-main class="viewer">
    <v-app-bar app>
      <slot name="title" />
      <span
        class="title pl-3 flex-row"
        style="white-space:nowrap;overflow:hidden;text-overflow: ellipsis;"
      >
        {{ datasetName }}
        <div
          v-if="readonlyState"
          class="mx-auto my-0 pa-0"
          style="line-height:0.2em;"
        >
          <v-tooltip
            bottom
          >
            <template v-slot:activator="{on}">
              <v-chip
                class="warning pr-1"
                style="white-space:nowrap;display:inline"
                small
                v-on="on"
              >
                Read Only Mode
                <v-icon
                  class="pl-1"
                  small
                >mdi-information-outline</v-icon>
              </v-chip>
            </template>
            <span>Read Only Mode: Editing, Deleting and Importing actions are disabled</span>
          </v-tooltip>
        </div>
      </span>
      <v-spacer />
      <template #extension>
        <EditorMenu
          v-bind="{ editingMode, visibleModes, editingTrack,
                    recipes, mergeMode, editingDetails, linkingCamera }"
          :tail-settings.sync="clientSettings.annotatorPreferences.trackTails"
          @set-annotation-state="handler.setAnnotationState"
          @exit-edit="handler.trackAbort"
        >
          <template slot="delete-controls">
            <delete-controls
              v-bind="{ editingMode, selectedFeatureHandle }"
              class="mr-2"
              @delete-point="handler.removePoint"
              @delete-annotation="handler.removeAnnotation"
            />
          </template>
        </EditorMenu>
        <v-select
          v-if="multiCamList.length > 1"
          :value="selectedCamera"
          :items="multiCamList"
          label="Camera"
          class="shrink"
          style="width: 180px;"
          outlined
          hide-details
          dense
          @change="changeCamera"
        >
          <template #item="{ item }">
            {{ item }} {{ item === defaultCamera ? '(Default)': '' }}
          </template>
        </v-select>
        <v-badge
          v-if="multiCamList.length > 1"
          overlap
          bottom
          right
          color="clear"
          class="pl-1"
        >
          <template v-slot:badge>
            <v-icon>
              mdi-cog
            </v-icon>
          </template>
          <v-btn
            icon
            small
            title="MultiCamera Settings"
            @click="context.toggle('MultiCamTools')"
          >
            <v-icon>
              mdi-camera
            </v-icon>
          </v-btn>
        </v-badge>
        <slot name="extension-right" />
      </template>

      <slot name="title-right" />
      <user-guide-button annotating />

      <v-tooltip
        bottom
        :disabled="!readonlyState"
      >
        <template v-slot:activator="{ on }">
          <v-badge
            overlap
            bottom
            :color="readonlyState ? 'warning' : undefined"
            :icon="readonlyState ? 'mdi-exclamation-thick' : undefined"
            :content="!readonlyState ? pendingSaveCount : undefined"
            :value="readonlyState || pendingSaveCount > 0"
            offset-x="14"
            offset-y="18"
          >
            <div v-on="on">
              <v-btn
                icon
                :disabled="readonlyState || pendingSaveCount === 0 || saveInProgress"
                @click="save"
              >
                <v-icon>mdi-content-save</v-icon>
              </v-btn>
            </div>
          </v-badge>
        </template>
        <span>Read only mode, cannot save changes</span>
      </v-tooltip>
    </v-app-bar>

    <v-row
      no-gutters
      class="fill-height"
      style="min-width: 700px;"
    >
      <sidebar
        :enable-slot="context.state.active !== 'TypeThreshold'"
        class="fill-height"
        @import-types="importTypes($event)"
      >
        <template v-if="context.state.active !== 'TypeThreshold'">
          <v-divider />
          <ConfidenceFilter
            class="ma-2 mb-0"
            :confidence.sync="confidenceFilters.default"
            @end="saveThreshold"
          >
            <a
              style="text-decoration: underline; color: white;"
              @click="context.toggle('TypeThreshold')"
            >
              Advanced
            </a>
          </ConfidenceFilter>
        </template>
      </sidebar>
      <v-col
        style="position: relative;"
        class="d-flex flex-column grow"
        dense
      >
        <div
          v-if="progress.loaded"
          v-mousetrap="[
            { bind: 'n', handler: () => !readonlyState && handler.trackAdd() },
            { bind: 'r', handler: () => aggregateController.resetZoom() },
            { bind: 'esc', handler: () => handler.trackAbort() },
          ]"
          class="d-flex flex-column grow"
        >
          <div class="d-flex grow">
            <div
              v-for="camera in multiCamList"
              :key="camera"
              class="d-flex flex-column grow"
              :style="{ height: `calc(100% - ${controlsHeight}px)`}"
              @mousedown.left="changeCamera(camera, $event)"
              @mouseup.right="changeCamera(camera, $event)"
            >
              <component
                :is="datasetType === 'image-sequence' ? 'image-annotator' : 'video-annotator'"
                v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
                ref="subPlaybackComponent"
                class="fill-height"
                :class="{'selected-camera': selectedCamera === camera && camera !== 'singleCam'}"
                v-bind="{
                  imageData: imageData[camera], videoUrl: videoUrl[camera],
                  updateTime, frameRate, originalFps, camera, brightness, intercept }"
              >
                <LayerManager :camera="camera" />
              </component>
            </div>
          </div>
          <ControlsContainer
            ref="controlsRef"
            class="shrink"
            :collapsed.sync="controlsCollapsed"
            v-bind="{ lineChartData, eventChartData, datasetType }"
            @select-track="handler.trackSelect"
          />
        </div>
        <div
          v-else
          class="d-flex justify-center align-center fill-height"
        >
          <v-alert
            v-if="loadError"
            type="error"
            prominent
            max-width="60%"
          >
            <p class="ma-2">
              {{ loadError }}
            </p>
          </v-alert>
          <v-progress-circular
            v-else
            :indeterminate="progressValue === 0"
            :value="progressValue"
            size="100"
            width="15"
            color="light-blue"
            class="main-progress-linear"
            rotate="-90"
          >
            <span v-if="progressValue === 0">Loading</span>
            <span v-else>{{ progressValue }}%</span>
          </v-progress-circular>
        </div>
      </v-col>
      <slot name="right-sidebar" />
    </v-row>
  </v-main>
</template>

<style lang="scss">
html {
  overflow-y: auto;
  scrollbar-face-color: #646464;
  scrollbar-base-color: #646464;
  scrollbar-3dlight-color: #646464;
  scrollbar-highlight-color: #646464;
  scrollbar-track-color: #000;
  scrollbar-arrow-color: #000;
  scrollbar-shadow-color: #646464;
}
::-webkit-scrollbar { width: 10px; height: 3px;}
::-webkit-scrollbar-button {  background-color: #666; height: 0px; }
::-webkit-scrollbar-track {  background-color: #646464;}
::-webkit-scrollbar-track-piece { background-color: #1E1E1E;}
::-webkit-scrollbar-thumb { height: 30px; background-color: #666; border-radius: 3px;}
::-webkit-scrollbar-corner { background-color: #646464;}
::-webkit-resizer { background-color: #666;}

.text-xs-center {
  text-align: center !important;
}

.annotator-wrapper {
  position: relative;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
}
</style>
