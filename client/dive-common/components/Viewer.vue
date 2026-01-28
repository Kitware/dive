<script lang="ts">
import {
  defineComponent, defineAsyncComponent, ref, toRef, computed, Ref,
  reactive, watch, inject, nextTick, onBeforeUnmount, PropType,
} from 'vue';
import type { Vue } from 'vue/types/vue';
import type Vuetify from 'vuetify/lib';
import { cloneDeep, debounce } from 'lodash';

/* VUE MEDIA ANNOTATOR */
import {
  useAttributes,
  useImageEnhancements,
  useLineChart,
  useTimeObserver,
  useEventChart,
} from 'vue-media-annotator/use';
import {
  Track, Group,
  CameraStore,
  StyleManager, TrackFilterControls, GroupFilterControls,
} from 'vue-media-annotator/index';
import { provideAnnotator } from 'vue-media-annotator/provides';

import {
  ImageAnnotator,
  VideoAnnotator,
  LargeImageAnnotator,
  LayerManager,
  useMediaController,
  TrackList,
  FilterList,
} from 'vue-media-annotator/components';
import type { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import { getResponseError } from 'vue-media-annotator/utils';

/* DIVE COMMON */
import PolygonBase from 'dive-common/recipes/polygonbase';
import HeadTail from 'dive-common/recipes/headtail';
import SegmentationPointClick from 'dive-common/recipes/segmentationpointclick';
import EditorMenu from 'dive-common/components/EditorMenu.vue';
import ConfidenceFilter from 'dive-common/components/ConfidenceFilter.vue';
import UserGuideButton from 'dive-common/components/UserGuideButton.vue';
import TypeSettingsPanel from 'dive-common/components/TypeSettingsPanel.vue';
import TrackSettingsPanel from 'dive-common/components/TrackSettingsPanel.vue';
import TrackListColumnSettings from 'dive-common/components/TrackListColumnSettings.vue';
import TrackDetailsPanel from 'dive-common/components/TrackDetailsPanel.vue';
import ConfidenceSubsection from 'dive-common/components/ConfidenceSubsection.vue';
import AttributeSubsection from 'dive-common/components/Attributes/AttributesSubsection.vue';
import AttributeEditor from 'dive-common/components/Attributes/AttributeEditor.vue';
import DeleteControls from 'dive-common/components/DeleteControls.vue';
import type { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import ControlsContainer from 'dive-common/components/ControlsContainer.vue';
import Sidebar from 'dive-common/components/Sidebar.vue';
import { useModeManager, useSave } from 'dive-common/use';
import type { StereoAnnotationCompleteParams } from 'dive-common/use/useModeManager';
import clientSettingsSetup, { clientSettings } from 'dive-common/store/settings';
import { useApi, FrameImage, DatasetType } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import context from 'dive-common/store/context';
import { MarkChangesPendingFilter } from 'vue-media-annotator/BaseFilterControls';
import GroupSidebarVue from './GroupSidebar.vue';
import MultiCamToolsVue from './MultiCamTools.vue';
import MultiCamToolbar from './MultiCamToolbar.vue';
import PrimaryAttributeTrackFilter from './PrimaryAttributeTrackFilter.vue';

// NativeVideoAnnotator uses electron APIs - only load in desktop app
// The webpackIgnore comment prevents bundling in web builds
const NativeVideoAnnotator = defineAsyncComponent(
  () => import(/* webpackIgnore: true */ 'vue-media-annotator/components/annotators/NativeVideoAnnotator.vue'),
);

export interface ImageDataItem {
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
    NativeVideoAnnotator,
    ImageAnnotator,
    LargeImageAnnotator,
    ConfidenceFilter,
    UserGuideButton,
    EditorMenu,
    MultiCamToolbar,
    PrimaryAttributeTrackFilter,
    TrackList,
    FilterList,
    TypeSettingsPanel,
    TrackSettingsPanel,
    TrackListColumnSettings,
    TrackDetailsPanel,
    ConfidenceSubsection,
    AttributeSubsection,
    AttributeEditor,
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
    currentSet: {
      type: String,
      default: '',
    },
    comparisonSets: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  setup(props, { emit }) {
    const { prompt, visible } = usePrompt();
    const loadError = ref('');
    const baseMulticamDatasetId = ref(null as string | null);
    const datasetId = toRef(props, 'id');
    const multiCamList: Ref<string[]> = ref(['singleCam']);
    const defaultCamera = ref('singleCam');
    const playbackComponent = ref(undefined as Vue | undefined);
    const readonlyState = computed(() => props.readOnlyMode
    || props.revision !== undefined || !!(props.comparisonSets && props.comparisonSets.length));
    const sets: Ref<string[]> = ref([]);
    const displayComparisons = ref(props.comparisonSets.length
      ? props.comparisonSets.slice(0, 1) : props.comparisonSets);
    const selectedSet = ref('');
    const {
      aggregateController,
      onResize,
      clear: mediaControllerClear,
    } = useMediaController();
    const { time, updateTime, initialize: initTime } = useTimeObserver();
    const imageData = ref({ singleCam: [] } as Record<string, FrameImage[]>);
    const datasetType: Ref<DatasetType> = ref('image-sequence');
    const datasetName = ref('');
    const subType = ref(null as string | null);
    const saveInProgress = ref(false);
    const videoUrl: Ref<Record<string, string>> = ref({});
    const nativeVideoPath: Ref<Record<string, string>> = ref({});
    const {
      loadDetections, loadMetadata, saveMetadata, getTiles, getTileURL,
    } = useApi();
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
    const controlsRef = ref();
    const controlsHeight = ref(0);
    const controlsCollapsed = ref(false);
    const editorMenuRef = ref();

    /**
     * Forward text query service ready status to EditorMenu
     * Called by ViewerLoader when text query service initialization completes
     */
    function onTextQueryServiceReady(success: boolean, error?: string) {
      if (editorMenuRef.value?.onTextQueryServiceReady) {
        editorMenuRef.value.onTextQueryServiceReady(success, error);
      }
    }

    const sideBarCollapsed = ref(false);
    // Sidebar mode: 'left', 'bottom', or 'collapsed'
    const sidebarMode = ref(clientSettings.layoutSettings.sidebarPosition as 'left' | 'bottom' | 'collapsed');
    // Right panel view in bottom mode: 'filters' or 'details'
    const bottomRightPanelView = ref<'filters' | 'details'>('filters');
    const toggleBottomRightPanel = () => {
      bottomRightPanelView.value = bottomRightPanelView.value === 'filters' ? 'details' : 'filters';
    };
    const cycleSidebarMode = () => {
      if (sidebarMode.value === 'left') {
        sidebarMode.value = 'bottom';
        clientSettings.layoutSettings.sidebarPosition = 'bottom';
      } else if (sidebarMode.value === 'bottom') {
        sidebarMode.value = 'collapsed';
        // Keep setting as 'bottom' when collapsed (collapsed is a temporary state)
      } else {
        sidebarMode.value = 'left';
        clientSettings.layoutSettings.sidebarPosition = 'left';
      }
    };
    const sidebarModeIcon = computed(() => {
      if (sidebarMode.value === 'left') return 'mdi-page-layout-sidebar-left';
      if (sidebarMode.value === 'bottom') return 'mdi-page-layout-footer';
      return 'mdi-checkbox-blank-outline';
    });
    const sidebarModeTooltip = computed(() => {
      if (sidebarMode.value === 'left') return 'Sidebar: Left (click to cycle)';
      if (sidebarMode.value === 'bottom') return 'Sidebar: Bottom (click to cycle)';
      return 'Sidebar: Hidden (click to cycle)';
    });

    const progressValue = computed(() => {
      if (progress.total > 0 && (progress.progress !== progress.total)) {
        return Math.round((progress.progress / progress.total) * 100);
      }
      return 0;
    });

    /**
     * Annotation window style source based on value of timeline visualization
     */
    const colorBy = computed(() => {
      if (controlsRef.value?.currentView === 'Groups') {
        return 'group';
      }
      return 'track';
    });

    const {
      save: saveToServer,
      markChangesPending,
      discardChanges,
      pendingSaveCount,
      addCamera: addSaveCamera,
      removeCamera: removeSaveCamera,
    } = useSave(datasetId, readonlyState);

    const {
      imageEnhancements,
      imageEnhancementOutputs,
      isDefaultImage,
      setImageEnhancements,
      setSVGFilters,
    } = useImageEnhancements();

    const segmentationRecipe = new SegmentationPointClick();
    const recipes = [
      new PolygonBase(),
      new HeadTail(),
      segmentationRecipe,
    ];

    const vuetify = inject('vuetify') as Vuetify;
    const trackStyleManager = new StyleManager({ markChangesPending, vuetify });
    const groupStyleManager = new StyleManager({ markChangesPending, vuetify });

    const cameraStore = new CameraStore({ markChangesPending });
    // This context for removal
    const removeGroups = (id: AnnotationId) => {
      cameraStore.removeGroups(id);
    };
    const setTrackType = (
      id: AnnotationId,
      newType: string,
      confidenceVal?: number,
      currentType?: string,
    ) => {
      cameraStore.setTrackType(id, newType, confidenceVal, currentType);
    };
    const removeTypes = (id: AnnotationId, types: string[]) => cameraStore.removeTypes(id, types);
    const getTracksMerged = (id: AnnotationId) => cameraStore.getTracksMerged(id);
    const groupFilters = new GroupFilterControls({
      sorted: cameraStore.sortedGroups,
      markChangesPending: (markChangesPending as MarkChangesPendingFilter),
      remove: removeGroups,
      setType: setTrackType,
      removeTypes,
    });

    // This context for removal
    const removeTracks = (id: AnnotationId) => {
      cameraStore.removeTracks(id);
    };
    const trackFilters = new TrackFilterControls({
      sorted: cameraStore.sortedTracks,
      remove: removeTracks,
      markChangesPending: (markChangesPending as MarkChangesPendingFilter),
      lookupGroups: cameraStore.lookupGroups,
      getTrack: (track: AnnotationId, camera = 'singleCam') => (cameraStore.getTrack(track, camera)),
      groupFilterControls: groupFilters,
      setType: setTrackType,
      removeTypes,
    });

    clientSettingsSetup(trackFilters.allTypes);

    // Provides wrappers for actions to integrate with settings
    const {
      linkingTrack,
      linkingCamera,
      multiSelectList,
      multiSelectActive,
      selectedFeatureHandle,
      selectedTrackId,
      editingMultiTrack,
      editingGroupId,
      handler,
      editingMode,
      editingDetails,
      visibleModes,
      selectedKey,
      selectedCamera,
      editingTrack,
      segmentationPoints,
    } = useModeManager({
      recipes,
      trackFilterControls: trackFilters,
      groupFilterControls: groupFilters,
      cameraStore,
      aggregateController,
      readonlyState,
      onStereoAnnotationComplete: (params: StereoAnnotationCompleteParams) => {
        emit('stereo-annotation-complete', params);
      },
    });

    const {
      attributesList: attributes,
      loadAttributes,
      setAttribute,
      deleteAttribute,
      attributeFilters,
      deleteAttributeFilter,
      addAttributeFilter,
      modifyAttributeFilter,
      sortAndFilterAttributes,
      setTimelineEnabled,
      setTimelineFilter,
      attributeTimelineData,
      timelineFilter,
      timelineEnabled,

    } = useAttributes({
      markChangesPending,
      trackStyleManager,
      selectedTrackId,
      cameraStore,
    });

    const allSelectedIds = computed(() => {
      const selected = selectedTrackId.value;
      if (selected !== null) {
        return multiSelectList.value.concat(selected);
      }
      return multiSelectList.value;
    });

    const { lineChartData } = useLineChart({
      enabledTracks: trackFilters.enabledAnnotations,
      typeStyling: trackStyleManager.typeStyling,
      allTypes: trackFilters.allTypes,
      getTracksMerged,
    });

    const { eventChartData } = useEventChart({
      enabledTracks: trackFilters.enabledAnnotations,
      selectedTrackIds: allSelectedIds,
      typeStyling: trackStyleManager.typeStyling,
      getTracksMerged,
    });

    const { eventChartData: groupChartData } = useEventChart({
      enabledTracks: groupFilters.enabledAnnotations,
      typeStyling: groupStyleManager.typeStyling,
      selectedTrackIds: computed(() => {
        if (editingGroupId.value !== null) {
          return [editingGroupId.value];
        }
        return [];
      }),
      getTracksMerged,
    });

    async function trackSplit(trackId: AnnotationId | null, frame: number) {
      if (typeof trackId === 'number') {
        const track = cameraStore.getTrack(trackId, selectedCamera.value);
        const groups = cameraStore.lookupGroups(trackId);
        let newtracks: [Track, Track];
        try {
          newtracks = track.split(frame, cameraStore.getNewTrackId(), cameraStore.getNewTrackId() + 1);
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
        const trackStore = cameraStore.camMap.value.get(selectedCamera.value)?.trackStore;
        if (trackStore) {
          trackStore.remove(trackId);
          trackStore.insert(newtracks[0]);
          trackStore.insert(newtracks[1]);
        }
        if (groups.length) {
          // If the track belonged to groups, add the new tracks
          // to the same groups the old tracks belonged to.
          const groupStore = cameraStore.camMap.value.get(selectedCamera.value)?.groupStore;
          if (groupStore) {
            groupStore.trackRemove(trackId);
            groups.forEach((group) => {
              group.removeMembers([trackId]);
              group.addMembers({
                [newtracks[0].id]: { ranges: [[newtracks[0].begin, newtracks[0].end]] },
                [newtracks[1].id]: { ranges: [[newtracks[1].begin, newtracks[1].end]] },
              });
            });
          }
        }
        handler.trackSelect(newtracks[1].id, wasEditing);
      }
    }

    // Remove a track from within a camera multi-track into it's own track
    function unlinkCameraTrack(trackId: AnnotationId, camera: string) {
      const track = cameraStore.getTrack(trackId, camera);
      handler.trackSelect(null, false);
      const newTrack = Track.fromJSON({
        id: cameraStore.getNewTrackId(),
        meta: track.meta,
        begin: track.begin,
        end: track.end,
        features: track.features,
        confidencePairs: track.confidencePairs,
        attributes: track.attributes,
      });
      handler.removeTrack([trackId], true, camera);
      const trackStore = cameraStore.camMap.value.get(camera)?.trackStore;
      if (trackStore) {
        trackStore.insert(newTrack, { imported: false });
      }
      handler.trackSelect(newTrack.trackId);
    }
    /**
     * Takes a BaseTrack and a merge Track and will attempt to merge the existing track
     * into the camera and baseTrack.
     * Requires that baseTrack doesn't have a track for the camera already
     * Also requires that the mergeTrack isn't a track across multiple cameras.
     */
    function linkCameraTrack(baseTrack: AnnotationId, linkTrack: AnnotationId, camera: string) {
      cameraStore.camMap.value.forEach((subCamera, key) => {
        const { trackStore } = subCamera;
        if (trackStore && trackStore.getPossible(linkTrack) && key !== camera) {
          throw Error(`Attempting to link Track: ${linkTrack} to camera: ${camera} where there the track exists in another camera: ${key}`);
        }
      });
      const track = cameraStore.getTrack(linkTrack, camera);
      const selectedTrack = cameraStore.getAnyTrack(baseTrack);
      handler.removeTrack([linkTrack], true, camera);
      const newTrack = Track.fromJSON({
        id: baseTrack,
        meta: track.meta,
        begin: track.begin,
        end: track.end,
        features: track.features,
        confidencePairs: selectedTrack.confidencePairs,
        attributes: track.attributes,
      });
      const trackStore = cameraStore.camMap.value.get(camera)?.trackStore;
      if (trackStore) {
        trackStore.insert(newTrack, { imported: false });
      }
      handler.trackSelect(newTrack.id);
    }
    watch(linkingTrack, () => {
      if (linkingTrack.value !== null && selectedTrackId.value !== null) {
        linkCameraTrack(selectedTrackId.value, linkingTrack.value, linkingCamera.value);
        handler.stopLinking();
      }
    });
    async function save(setVal?: string, exitEditingMode = false) {
      // Only exit editing mode if explicitly requested (e.g., manual save)
      // Auto-save should NOT disrupt the user's editing session
      saveInProgress.value = true;
      if (exitEditingMode && editingTrack.value) {
        handler.trackSelect(selectedTrackId.value, false);
      }
      const saveSet = setVal === 'default' ? undefined : setVal;
      // Need to mark all items as updated for any non-default sets
      if (saveSet && setVal !== props.currentSet) {
        const singleCam = cameraStore.camMap.value.get('singleCam');
        if (singleCam) {
          singleCam.trackStore.annotationMap.forEach((track) => {
            markChangesPending({ action: 'upsert', track });
          });
        }
      }
      try {
        await saveToServer({
          customTypeStyling: trackStyleManager.getTypeStyles(trackFilters.allTypes),
          customGroupStyling: groupStyleManager.getTypeStyles(groupFilters.allTypes),
          confidenceFilters: trackFilters.confidenceFilters.value,
          imageEnhancements: imageEnhancements.value,
          // TODO Group confidence filters are not yet supported.
        }, saveSet);
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
        saveInProgress.value = false;
        throw err;
      }
      saveInProgress.value = false;
    }

    function saveThreshold() {
      saveMetadata(datasetId.value, {
        confidenceFilters: trackFilters.confidenceFilters.value,
      });
    }

    function saveImageEnhancements() {
      saveMetadata(datasetId.value, {
        imageEnhancements: imageEnhancements.value,
      });
    }
    const debouncedSaveImageEnhancements = debounce(saveImageEnhancements, 1000, { trailing: true });

    watch(imageEnhancements, debouncedSaveImageEnhancements, { deep: true });

    // Auto-save annotations when enabled
    const debouncedAutoSave = debounce(
      async () => {
        if (readonlyState.value) return;
        if (pendingSaveCount.value === 0) return;
        if (saveInProgress.value) return;
        await save(props.currentSet);
      },
      2000,
      { trailing: true, leading: false },
    );

    watch(
      pendingSaveCount,
      (newCount, oldCount) => {
        if (
          clientSettings.autoSaveSettings.enabled
          && newCount > oldCount
          && newCount > 0
          && !readonlyState.value
        ) {
          debouncedAutoSave();
        }
      },
    );

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

    async function handleSetChange(set: string) {
      const guard = await navigateAwayGuard();
      if (guard) {
        emit('update:set', set);
      }
    }

    const selectCamera = async (camera: string, editMode = false) => {
      if (linkingCamera.value !== '' && linkingCamera.value !== camera) {
        await prompt({
          title: 'In Linking Mode',
          text: ['Currently in Linking Mode, please hit OK and Escape to exit',
            'Linking mode or choose another Track in the highlighted Camera to Link'],
          positiveButton: 'OK',
        });
        return;
      }
      // EditTrack is set false by the LayerMap before executing this
      if (selectedTrackId.value !== null) {
        // If we had a track selected and it still exists with
        // a feature length of 0 we need to remove it
        const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
        if (track && track.features.length === 0) {
          handler.trackAbort();
        }
      }
      selectedCamera.value = camera;
      /**
       * Enters edit mode if no track exists for the camera and forcing edit mode
       * or if a track exists and are alrady in edit mode we don't set it again
       * Remember trackEdit(number) is a toggle for editing mode
       */
      if (selectedTrackId.value !== null && (editMode || editingTrack.value)) {
        const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
        if (track === undefined || !editingTrack.value) {
        //Stay in edit mode for the current track
          handler.trackEdit(selectedTrackId.value);
        }
      }
      emit('change-camera', camera);
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
      selectCamera(camera, event?.button === 2);
      emit('change-camera', camera);
    };
    /** Trigger data load */
    const loadData = async () => {
      try {
        // Close and reset sideBar
        context.resetActive();
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
        /* Otherwise, complete loading of the dataset */
        trackStyleManager.populateTypeStyles(meta.customTypeStyling);
        groupStyleManager.populateTypeStyles(meta.customGroupStyling);
        if (meta.customTypeStyling) {
          trackFilters.importTypes(Object.keys(meta.customTypeStyling), false);
        }
        if (meta.customGroupStyling) {
          groupFilters.importTypes(Object.keys(meta.customGroupStyling), false);
        }
        if (meta.attributes) {
          loadAttributes(meta.attributes);
        }
        trackFilters.setConfidenceFilters(meta.confidenceFilters);
        if (meta.imageEnhancements) {
          setImageEnhancements(meta.imageEnhancements);
        }
        datasetName.value = meta.name;
        subType.value = meta.subType || null;
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
          datasetType.value = subCameraMeta.type as DatasetType;

          imageData.value[camera] = cloneDeep(subCameraMeta.imageData) as FrameImage[];
          if (subCameraMeta.videoUrl) {
            videoUrl.value[camera] = subCameraMeta.videoUrl;
          }
          if (subCameraMeta.nativeVideoPath) {
            nativeVideoPath.value[camera] = subCameraMeta.nativeVideoPath;
          }
          cameraStore.addCamera(camera);
          addSaveCamera(camera);
          // eslint-disable-next-line no-await-in-loop
          const {
            tracks,
            groups,
            sets: foundSets,
            // eslint-disable-next-line no-await-in-loop
          } = await loadDetections(cameraId, props.revision, props.currentSet);
          sets.value = foundSets.filter((item) => item);
          if (props.currentSet !== '' || sets.value.length > 0) {
            sets.value.push('default');
          }
          selectedSet.value = props.currentSet ? props.currentSet : 'default';
          progress.total = tracks.length + groups.length;
          const trackStore = cameraStore.camMap.value.get(camera)?.trackStore;
          const groupStore = cameraStore.camMap.value.get(camera)?.groupStore;
          if (trackStore && groupStore) {
            // We can start sorting if our total tracks are less than 20000
            // If greater we do one sort at the end instead to speed loading.
            if (tracks.length < 20000) {
              trackStore.setEnableSorting();
            }
            let baseSet: string | undefined;
            if (props.comparisonSets.length) {
              baseSet = selectedSet.value;
            }

            for (let j = 0; j < tracks.length; j += 1) {
              if (j % 4000 === 0) {
              /* Every N tracks, yeild some cycles for other scheduled tasks */
                progress.progress = j;
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => window.setTimeout(resolve, 500));
              }
              trackStore.insert(Track.fromJSON(tracks[j], baseSet), { imported: true });
            }
            for (let j = 0; j < groups.length; j += 1) {
              if (j % 4000 === 0) {
              /* Every N tracks, yeild some cycles for other scheduled tasks */
                progress.progress = tracks.length + j;
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => window.setTimeout(resolve, 500));
              }
              groupStore.insert(Group.fromJSON(groups[j]), { imported: true });
            }
          }
          // Check if we load more data for comparions
          if (props.comparisonSets.length) {
            // Only compare one at a time
            const firstSet = props.comparisonSets.slice(0, 1);
            for (let setIndex = 0; setIndex < firstSet.length; setIndex += 1) {
              const loadingSet = firstSet[setIndex] === 'default' ? undefined : firstSet[setIndex];
              const {
                tracks: setTracks,
                groups: setGroups,
                // eslint-disable-next-line no-await-in-loop
              } = await loadDetections(cameraId, props.revision, loadingSet);
              progress.total = setTracks.length + setGroups.length;
              if (trackStore && groupStore) {
                // We can start sorting if our total tracks are less than 20000
                // If greater we do one sort at the end instead to speed loading.
                if (tracks.length < 20000) {
                  trackStore.setEnableSorting();
                }
                for (let j = 0; j < setTracks.length; j += 1) {
                  if (j % 4000 === 0) {
                    /* Every N tracks, yeild some cycles for other scheduled tasks */
                    progress.progress = j;
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((resolve) => window.setTimeout(resolve, 500));
                  }
                  // We need to increment the trackIds for the new comparison sets
                  setTracks[j].id = trackStore.getNewId();
                  trackStore.insert(
                    Track.fromJSON(
                      setTracks[j],
                      firstSet[setIndex],
                    ),
                    { imported: true },
                  );
                }
              }
            }
          }
        }
        cameraStore.camMap.value.forEach((cam, key) => {
          const { trackStore } = cam;
          // Enable Sorting after loading is complete if it isn't enabled already
          if (trackStore) {
            trackStore.setEnableSorting();
          }

          if (!multiCamList.value.includes(key)) {
            cameraStore.removeCamera(key);
            removeSaveCamera(key);
          }
        });
        // Needs to be done after the cameraMap is created
        if (meta.attributeTrackFilters) {
          trackFilters.loadTrackAttributesFilter(Object.values(meta.attributeTrackFilters));
        }
        progress.loaded = true;
        // If multiCam add Tools and remove group Tools
        if (cameraStore.camMap.value.size > 1) {
          context.unregister({
            description: 'Group Manager',
            component: GroupSidebarVue,
          });
          context.register({
            component: MultiCamToolsVue,
            description: 'Multi Camera Tools',
          });
        } else {
          context.unregister({
            component: MultiCamToolsVue,
            description: 'Multi Camera Tools',
          });
          context.register({
            description: 'Group Manager',
            component: GroupSidebarVue,
          });
        }
      } catch (err) {
        progress.loaded = false;
        console.error(err);
        const errorEl = document.createElement('div');
        errorEl.innerHTML = getResponseError(err);
        loadError.value = errorEl.innerText
          .concat(". If you don't know how to resolve this, please contact the server administrator.");
        throw err;
      }
    };
    loadData();

    const reloadAnnotations = async () => {
      progress.loaded = false;
      discardChanges();
      cameraStore.clearAll();
      mediaControllerClear();
      await loadData();
      displayComparisons.value = props.comparisonSets.length
        ? props.comparisonSets.slice(0, 1) : props.comparisonSets;
    };

    watch(datasetId, reloadAnnotations);
    watch(readonlyState, () => handler.trackSelect(null, false));
    // Update segmentation recipe when frame changes to show only current frame's points
    watch(() => time.frame.value, (newFrame) => {
      segmentationRecipe.handleFrameChange(newFrame);
    });

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
    watch([controlsCollapsed, sidebarMode], async () => {
      await nextTick();
      handleResize();
    });
    onBeforeUnmount(() => {
      debouncedAutoSave.cancel();
      if (controlsRef.value) observer.unobserve(controlsRef.value.$el);
    });

    const globalHandler = {
      ...handler,
      save,
      trackSplit,
      setAttribute,
      deleteAttribute,
      reloadAnnotations,
      setSVGFilters,
      selectCamera,
      linkCameraTrack,
      unlinkCameraTrack,
      setChange: handleSetChange,
    };

    const useAttributeFilters = {
      attributeFilters,
      addAttributeFilter,
      deleteAttributeFilter,
      modifyAttributeFilter,
      sortAndFilterAttributes,
      setTimelineEnabled,
      setTimelineFilter,
      attributeTimelineData,
      timelineFilter,
      timelineEnabled,

    };

    provideAnnotator(
      {
        annotatorPreferences: toRef(clientSettings, 'annotatorPreferences'),
        attributes,
        cameraStore,
        datasetId,
        editingMode,
        groupFilters,
        groupStyleManager,
        multiSelectList,
        pendingSaveCount,
        progress,
        revisionId: toRef(props, 'revision'),
        annotationSet: toRef(props, 'currentSet'),
        annotationSets: sets,
        comparisonSets: toRef(props, 'comparisonSets'),
        segmentationPoints,
        selectedCamera,
        selectedKey,
        selectedTrackId,
        editingMultiTrack,
        editingGroupId,
        time,
        trackFilters,
        trackStyleManager,
        visibleModes,
        readOnlyMode: readonlyState,
        imageEnhancements,
      },
      globalHandler,
      useAttributeFilters,
    );

    const disableAnnotationFilters = computed(() => (
      trackFilters.disableAnnotationFilters.value
    ));

    // For bottom panel details view
    const selectedTrackForDetails = computed(() => {
      if (selectedTrackId.value !== null) {
        return cameraStore.getAnyTrack(selectedTrackId.value);
      }
      return null;
    });

    // Determine if confidence should be shown first (multiple types) or last (0-1 types)
    const showConfidenceFirst = computed(() => {
      if (selectedTrackForDetails.value) {
        return selectedTrackForDetails.value.confidencePairs.length > 1;
      }
      return false;
    });

    // Check if track has any track-level attributes set
    const hasTrackAttributes = computed(() => {
      if (selectedTrackForDetails.value && selectedTrackForDetails.value.attributes) {
        const attrs = selectedTrackForDetails.value.attributes;
        // Check if any non-userAttributes keys exist with values
        return Object.keys(attrs).some(
          (key) => key !== 'userAttributes' && attrs[key] !== undefined,
        );
      }
      return false;
    });

    // Determine attribute order: true = track first, false = detection first
    // If track has attributes, show track first; otherwise show detection first
    const showTrackAttributesFirst = computed(() => hasTrackAttributes.value);

    // Attribute editing state for bottom panel
    const editIndividual: Ref<Attribute | null> = ref(null);
    const editingAttribute: Ref<Attribute | null> = ref(null);
    const editingError: Ref<string | null> = ref(null);

    function setEditIndividual(attribute: Attribute | null) {
      editIndividual.value = attribute;
    }

    function resetEditIndividual(event: MouseEvent) {
      if (editIndividual.value) {
        const path = event.composedPath() as HTMLElement[];
        const inputs = ['INPUT', 'SELECT'];
        if (
          path.find(
            (item: HTMLElement) => (item.classList && item.classList.contains('v-input'))
              || inputs.includes(item.nodeName),
          )
        ) {
          return;
        }
        editIndividual.value = null;
      }
    }

    function addAttribute(type: 'Track' | 'Detection') {
      const belongs = type.toLowerCase() as 'track' | 'detection';
      editingAttribute.value = {
        belongs,
        datatype: 'text',
        name: `New${type}Attribute`,
        key: '',
      };
    }

    function editAttribute(attribute: Attribute) {
      editingAttribute.value = attribute;
    }

    async function closeAttributeEditor() {
      editingAttribute.value = null;
      editingError.value = null;
    }

    async function saveAttributeHandler({ data, oldAttribute, close }: {
      oldAttribute?: Attribute;
      data: Attribute;
      close: boolean;
    }) {
      editingError.value = null;
      if (!oldAttribute && attributes.value.some((attribute) => (
        attribute.name === data.name
        && attribute.belongs === data.belongs))) {
        editingError.value = 'Attribute with that name exists';
        return;
      }
      try {
        await setAttribute({ data, oldAttribute });
      } catch (err) {
        editingError.value = (err as Error).message;
      }
      if (!editingError.value && close) {
        closeAttributeEditor();
      }
    }

    async function deleteAttributeHandler(data: Attribute) {
      editingError.value = null;
      try {
        await deleteAttribute({ data });
      } catch (err) {
        editingError.value = (err as Error).message;
      }
      if (!editingError.value) {
        closeAttributeEditor();
      }
    }

    return {
      /* props */
      aggregateController,
      confidenceFilters: trackFilters.confidenceFilters,
      cameraStore,
      controlsRef,
      controlsHeight,
      controlsCollapsed,
      sideBarCollapsed,
      editorMenuRef,
      onTextQueryServiceReady,
      sidebarMode,
      cycleSidebarMode,
      sidebarModeIcon,
      sidebarModeTooltip,
      bottomRightPanelView,
      toggleBottomRightPanel,
      colorBy,
      clientSettings,
      datasetName,
      datasetType,
      subType,
      editingTrack,
      editingMode,
      editingDetails,
      eventChartData,
      groupChartData,
      imageData,
      lineChartData,
      loadError,
      multiSelectActive,
      pendingSaveCount,
      progress,
      progressValue,
      saveInProgress,
      playbackComponent,
      recipes,
      segmentationRecipe,
      selectedFeatureHandle,
      selectedTrackId,
      editingGroupId,
      selectedKey,
      trackFilters,
      videoUrl,
      nativeVideoPath,
      visibleModes,
      frameRate: time.frameRate,
      originalFps: time.originalFps,
      context,
      readonlyState,
      imageEnhancementOutputs,
      isDefaultImage,
      disableAnnotationFilters,
      trackStyleManager,
      visible,
      selectedTrackForDetails,
      showConfidenceFirst,
      showTrackAttributesFirst,
      attributes,
      /* Attribute editing for bottom panel */
      editIndividual,
      editingAttribute,
      editingError,
      setEditIndividual,
      resetEditIndividual,
      addAttribute,
      editAttribute,
      closeAttributeEditor,
      saveAttributeHandler,
      deleteAttributeHandler,
      /* large image methods */
      getTiles,
      getTileURL,
      /* methods */
      handler: globalHandler,
      save,
      saveThreshold,
      updateTime,
      // multicam
      multiCamList,
      defaultCamera,
      selectedCamera,
      changeCamera,
      // For Navigation Guarding
      navigateAwayGuard,
      warnBrowserExit,
      reloadAnnotations,
      // Annotation Sets,
      sets,
      selectedSet,
      displayComparisons,
      annotationSetColor: trackStyleManager.typeStyling.value.annotationSetColor,
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
        <v-tooltip
          v-if="currentSet || sets.length > 0 || comparisonSets.length"
          bottom
        >
          <template #activator="{ on }">
            <v-chip
              outlined
              :color="annotationSetColor(currentSet || 'default')"
              small
              v-on="on"
              @click="context.toggle('AnnotationSets')"
            > {{ currentSet || 'default' }}</v-chip>

          </template>
          <span>Custom Annotation Set.  Click to open the Annotation Set Settings</span>
        </v-tooltip>
        <span
          v-if="displayComparisons && displayComparisons.length"
          style="font-size:small"
          class="px-2"
        > Comparing: </span>

        <v-tooltip
          v-if="displayComparisons && displayComparisons.length"
          bottom
        >
          <template #activator="{ on: onIcon }">
            <v-chip
              class="pl-2"
              small
              outlined
              :color="annotationSetColor(displayComparisons[0] || 'default')"
              v-on="onIcon"
            > {{ displayComparisons[0] }}</v-chip>
          </template>
          Click on the {{ currentSet || 'default' }} chip to open the Comparison Menu
        </v-tooltip>
        <div
          v-if="readonlyState"
          class="mx-auto my-0 pa-0"
          style="line-height:0.2em;"
        >
          <v-tooltip
            bottom
          >
            <template #activator="{ on }">
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
        <v-tooltip
          bottom
        >
          <template #activator="{ on }">
            <v-icon
              v-on="on"
              @click="cycleSidebarMode"
            >
              {{ sidebarModeIcon }}
            </v-icon>
          </template>
          <span>{{ sidebarModeTooltip }}</span>
        </v-tooltip>

        <EditorMenu
          ref="editorMenuRef"
          v-bind="{
            editingMode,
            visibleModes,
            editingTrack,
            recipes,
            multiSelectActive,
            editingDetails,
            groupEditActive: editingGroupId !== null,
          }"
          :tail-settings.sync="clientSettings.annotatorPreferences.trackTails"
          @set-annotation-state="handler.setAnnotationState"
          @exit-edit="handler.trackAbort"
          @text-query-init="$emit('text-query-init')"
          @text-query="$emit('text-query', $event)"
          @text-query-all-frames="$emit('text-query-all-frames', $event)"
        >
          <template slot="delete-controls">
            <delete-controls
              v-bind="{ editingMode, selectedFeatureHandle }"
              class="mr-2"
              @delete-point="handler.removePoint"
              @delete-annotation="handler.removeAnnotation"
              @add-hole="handler.addHole"
              @add-polygon="handler.addPolygon"
            />
          </template>
          <template
            v-if="multiCamList.length > 1 && clientSettings.multiCamSettings.showToolbar && selectedCamera === multiCamList[0]"
            slot="multicam-controls-left"
          >
            <multi-cam-toolbar />
          </template>
          <template
            v-if="multiCamList.length > 1 && clientSettings.multiCamSettings.showToolbar && selectedCamera !== multiCamList[0]"
            slot="multicam-controls-right"
          >
            <multi-cam-toolbar />
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
            {{ item }} {{ item === defaultCamera ? '(Default)' : '' }}
          </template>
        </v-select>
        <v-divider
          vertical
          class="mx-2"
        />
        <v-tooltip
          bottom
          :z-index="20"
        >
          <template #activator="{ on }">
            <v-icon
              v-on="on"
              @click="context.toggle()"
            >
              {{ context.state.active ? 'mdi-chevron-right-box' : 'mdi-chevron-left-box' }}
            </v-icon>
          </template>
          <span>Menus for Advanced Tools/Settings</span>
        </v-tooltip>

        <slot name="extension-right" />
      </template>

      <slot name="title-right" />
      <user-guide-button annotating />

      <v-tooltip
        bottom
        :disabled="!readonlyState"
      >
        <template #activator="{ on }">
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
                @click="save(currentSet)"
              >
                <v-icon>
                  {{ clientSettings.autoSaveSettings.enabled ? 'mdi-content-save-cog' : 'mdi-content-save' }}
                </v-icon>
              </v-btn>
            </div>
          </v-badge>
        </template>
        <span>Read only mode, cannot save changes</span>
      </v-tooltip>
    </v-app-bar>

    <!-- Left sidebar layout -->
    <v-row
      v-if="sidebarMode === 'left'"
      no-gutters
      class="fill-height"
      style="min-width: 700px;"
    >
      <sidebar
        :is-stereo-dataset="subType === 'stereo'"
        @import-types="trackFilters.importTypes($event)"
        @track-seek="aggregateController.seek($event)"
      >
        <template>
          <v-divider />
          <primary-attribute-track-filter
            :toggle="context.toggle"
          />
          <ConfidenceFilter
            v-if="context.state.active !== 'TypeThreshold'"
            class="ma-2 mb-0"
            :confidence.sync="confidenceFilters.default"
            :disabled="disableAnnotationFilters"
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
            { bind: 'e', handler: () => multiCamList.length === 1 && selectedTrackId !== null && handler.trackEdit(selectedTrackId) },
          ]"
          class="d-flex flex-column grow"
        >
          <div class="d-flex grow">
            <div
              v-for="camera in multiCamList"
              :key="camera"
              class="d-flex flex-column grow"
              :style="{ height: `calc(100% - ${controlsHeight}px)` }"
              @mousedown.left="changeCamera(camera, $event)"
              @mouseup.right="changeCamera(camera, $event)"
            >
              <component
                :is="datasetType === 'image-sequence' ? 'image-annotator'
                  : datasetType === 'video'
                    ? (nativeVideoPath[camera] ? 'native-video-annotator' : 'video-annotator')
                    : 'large-image-annotator'"
                v-if="(imageData[camera].length || videoUrl[camera] || nativeVideoPath[camera]) && progress.loaded"
                ref="subPlaybackComponent"
                class="fill-height"
                :class="{ 'selected-camera': selectedCamera === camera && camera !== 'singleCam' }"
                v-bind="{
                  imageData: imageData[camera],
                  videoUrl: videoUrl[camera],
                  nativeVideoPath: nativeVideoPath[camera],
                  updateTime,
                  frameRate,
                  originalFps,
                  camera,
                  imageEnhancementOutputs,
                  isDefaultImage,
                  getTiles,
                  getTileURL,
                }"
                @large-image-warning="$emit('large-image-warning', true)"
              >
                <LayerManager :camera="camera" />
              </component>
            </div>
          </div>
          <ControlsContainer
            ref="controlsRef"
            :collapsed.sync="controlsCollapsed"
            v-bind="{
              lineChartData, eventChartData, groupChartData, datasetType, isDefaultImage,
            }"
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
      <slot
        name="right-sidebar"
        :sidebar-mode="sidebarMode"
      />
    </v-row>

    <!-- Bottom sidebar layout or collapsed -->
    <div
      v-else
      class="d-flex flex-column fill-height"
      style="min-width: 700px;"
    >
      <div
        v-if="progress.loaded"
        v-mousetrap="[
          { bind: 'n', handler: () => !readonlyState && handler.trackAdd() },
          { bind: 'r', handler: () => aggregateController.resetZoom() },
          { bind: 'esc', handler: () => handler.trackAbort() },
          { bind: 'e', handler: () => multiCamList.length === 1 && selectedTrackId !== null && handler.trackEdit(selectedTrackId) },
        ]"
        class="d-flex flex-column grow"
        style="min-height: 0;"
      >
        <!-- Video/annotator area -->
        <div class="d-flex grow" style="min-height: 0;">
          <div
            v-for="camera in multiCamList"
            :key="camera"
            class="d-flex flex-column grow"
            @mousedown.left="changeCamera(camera, $event)"
            @mouseup.right="changeCamera(camera, $event)"
          >
            <component
              :is="datasetType === 'image-sequence' ? 'image-annotator'
                : datasetType === 'video' ? 'video-annotator' : 'large-image-annotator'"
              v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
              ref="subPlaybackComponent"
              class="fill-height"
              :class="{ 'selected-camera': selectedCamera === camera && camera !== 'singleCam' }"
              v-bind="{
                imageData: imageData[camera],
                videoUrl: videoUrl[camera],
                updateTime,
                frameRate,
                originalFps,
                camera,
                imageEnhancementOutputs,
                isDefaultImage,
                getTiles,
                getTileURL,
              }"
              @large-image-warning="$emit('large-image-warning', true)"
            >
              <LayerManager :camera="camera" />
            </component>
          </div>
        </div>
        <!-- Bottom panel: timeline, track list, and type filters side by side -->
        <div
          class="d-flex flex-shrink-0"
          :style="{
            'border-top': '1px solid #444',
            height: sidebarMode === 'bottom' ? '260px' : 'auto',
          }"
        >
          <!-- Left: Timeline and controls -->
          <div
            class="d-flex flex-column bottom-panel-section"
            :style="{
              width: sidebarMode === 'bottom' ? '28%' : '100%',
              'min-width': '0',
              overflow: 'hidden',
            }"
          >
            <ControlsContainer
              ref="controlsRef"
              bottom-layout
              :collapsed.sync="controlsCollapsed"
              v-bind="{
                lineChartData, eventChartData, groupChartData, datasetType, isDefaultImage,
              }"
            />
          </div>

          <!-- Middle: Track list -->
          <div
            v-if="sidebarMode === 'bottom'"
            class="d-flex flex-column bottom-panel-section"
            :style="{
              width: '44%',
              'min-width': '0',
              overflow: 'hidden',
            }"
          >
            <TrackList
              class="fill-height"
              compact
              :new-track-mode="clientSettings.trackSettings.newTrackSettings.mode"
              :new-track-type="clientSettings.trackSettings.newTrackSettings.type"
              :lock-types="clientSettings.typeSettings.lockTypes"
              :hotkeys-disabled="visible() || readonlyState"
              :height="220"
              :fps="frameRate"
              :disabled="disableAnnotationFilters"
              @track-seek="aggregateController.seek($event)"
            >
              <template slot="settings">
                <TrackSettingsPanel
                  :all-types="trackFilters.allTypes"
                />
              </template>
              <template slot="column-settings">
                <TrackListColumnSettings
                  :attributes="attributes"
                  :fps="frameRate"
                />
              </template>
            </TrackList>
          </div>

          <!-- Right: Type filters/confidence OR Track details -->
          <div
            v-if="sidebarMode === 'bottom'"
            class="d-flex flex-column bottom-panel-section"
            :style="{
              width: '28%',
              'min-width': '0',
              overflow: 'hidden',
            }"
          >
            <!-- Header with toggle button -->
            <div class="right-panel-header d-flex align-center px-2 py-1">
              <span class="right-panel-title">
                {{ bottomRightPanelView === 'filters' ? 'Type Filters' : 'Track Details' }}
              </span>
              <v-spacer />
              <v-tooltip bottom>
                <template #activator="{ on }">
                  <v-btn
                    icon
                    x-small
                    v-on="on"
                    @click="toggleBottomRightPanel"
                  >
                    <v-icon small>
                      {{ bottomRightPanelView === 'filters' ? 'mdi-card-text' : 'mdi-filter-variant' }}
                    </v-icon>
                  </v-btn>
                </template>
                <span>{{ bottomRightPanelView === 'filters' ? 'Switch to Track Details' : 'Switch to Type Filters' }}</span>
              </v-tooltip>
            </div>

            <!-- Filters view -->
            <template v-if="bottomRightPanelView === 'filters'">
              <!-- Type filters -->
              <div class="flex-grow-1 bottom-filter-list" style="overflow-y: auto; overflow-x: hidden;">
                <FilterList
                  :show-empty-types="clientSettings.typeSettings.showEmptyTypes"
                  :height="130"
                  :width="300"
                  :style-manager="trackStyleManager"
                  :filter-controls="trackFilters"
                  :disabled="disableAnnotationFilters"
                  class="fill-height"
                >
                  <template #settings>
                    <TypeSettingsPanel
                      :all-types="trackFilters.allTypes"
                      @import-types="trackFilters.importTypes($event)"
                    />
                  </template>
                </FilterList>
              </div>
              <!-- Confidence slider at bottom -->
              <div class="confidence-row-bottom px-2 py-1">
                <ConfidenceFilter
                  :confidence.sync="confidenceFilters.default"
                  :disabled="disableAnnotationFilters"
                  text="Confidence"
                  @end="saveThreshold"
                />
              </div>
            </template>

            <!-- Track details view (simplified for bottom mode) -->
            <template v-else>
              <div
                class="flex-grow-1 bottom-details-panel"
                style="overflow-y: auto; overflow-x: hidden;"
                @click="resetEditIndividual"
              >
                <div v-if="selectedTrackForDetails" class="pa-2">
                  <!-- Type classifications (first if multiple types) -->
                  <ConfidenceSubsection
                    v-if="showConfidenceFirst"
                    :confidence-pairs="selectedTrackForDetails.confidencePairs"
                    :disabled="false"
                    @set-type="selectedTrackForDetails.setType($event)"
                  />
                  <!-- Attributes: Track first if has values, otherwise Detection first -->
                  <template v-if="showTrackAttributesFirst">
                    <AttributeSubsection
                      mode="Track"
                      :attributes="attributes"
                      :edit-individual="editIndividual"
                      @edit-attribute="editAttribute($event)"
                      @set-edit-individual="setEditIndividual($event)"
                      @add-attribute="addAttribute"
                    />
                    <AttributeSubsection
                      mode="Detection"
                      :attributes="attributes"
                      :edit-individual="editIndividual"
                      @edit-attribute="editAttribute($event)"
                      @set-edit-individual="setEditIndividual($event)"
                      @add-attribute="addAttribute"
                    />
                  </template>
                  <template v-else>
                    <AttributeSubsection
                      mode="Detection"
                      :attributes="attributes"
                      :edit-individual="editIndividual"
                      @edit-attribute="editAttribute($event)"
                      @set-edit-individual="setEditIndividual($event)"
                      @add-attribute="addAttribute"
                    />
                    <AttributeSubsection
                      mode="Track"
                      :attributes="attributes"
                      :edit-individual="editIndividual"
                      @edit-attribute="editAttribute($event)"
                      @set-edit-individual="setEditIndividual($event)"
                      @add-attribute="addAttribute"
                    />
                  </template>
                  <!-- Type classifications (last if 0-1 types) -->
                  <ConfidenceSubsection
                    v-if="!showConfidenceFirst"
                    :confidence-pairs="selectedTrackForDetails.confidencePairs"
                    :disabled="false"
                    @set-type="selectedTrackForDetails.setType($event)"
                  />
                </div>
                <div v-else class="pa-3 text-caption grey--text">
                  No track selected. Select a track to view its type classifications and attributes.
                </div>
              </div>
            </template>
          </div>
        </div>
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
      <slot
        name="right-sidebar"
        :sidebar-mode="sidebarMode"
      />
    </div>
    <!-- Attribute editor dialog for bottom panel -->
    <v-dialog
      :value="editingAttribute != null"
      max-width="550"
      @click:outside="closeAttributeEditor"
      @keydown.esc.stop="closeAttributeEditor"
    >
      <AttributeEditor
        v-if="editingAttribute != null"
        :selected-attribute="editingAttribute"
        :error="editingError"
        @close="closeAttributeEditor"
        @save="saveAttributeHandler"
        @delete="deleteAttributeHandler"
      />
    </v-dialog>
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

.bottom-panel-section {
  background-color: #1e1e1e;
  border: 1px solid #555;
  border-radius: 4px;
  margin: 4px;
}

.confidence-row-bottom {
  background-color: #262626;
  border-top: 1px solid #444;
  flex-shrink: 0;
  padding-top: 4px !important;
  padding-bottom: 4px !important;

  /* Match title styling with Tracks header */
  .text-body-2 {
    font-size: 14px !important;
    font-weight: 600;
    color: white !important;
  }
}

.bottom-filter-list {
  /* Match title styling with Tracks header */
  #type-header b {
    font-size: 14px;
    font-weight: 600;
    color: white;
  }
}

.right-panel-header {
  background-color: #262626;
  border-bottom: 1px solid #444;
  flex-shrink: 0;
  min-height: 28px;
}

.right-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: white;
}

</style>
