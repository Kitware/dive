<script lang="ts">
import {
  defineComponent, ref, toRef, computed, Ref,
  reactive, watch, inject, provide, nextTick, onBeforeUnmount, PropType, set as VueSet,
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
  CameraRegistrationStore,
  AlignedViewStore,
  StyleManager, TrackFilterControls, GroupFilterControls,
} from 'vue-media-annotator/index';
import { resolveToReferenceTransforms, unresolvedCameras } from 'vue-media-annotator/alignedView/alignedView';
import { provideAnnotator, LassoModeSymbol } from 'vue-media-annotator/provides';

import {
  ImageAnnotator,
  VideoAnnotator,
  LargeImageAnnotator,
  LayerManager,
  useMediaController,
  useRegistrationNavigation,
  useAlignedNavigation,
  TrackList,
  FilterList,
} from 'vue-media-annotator/components';
import type { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import type { SetTimeFunc } from 'vue-media-annotator/use/useTimeObserver';
import { getResponseError, featureHasSegmentationPolygon } from 'vue-media-annotator/utils';

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
import BottomPanel from 'dive-common/components/BottomPanel.vue';
import { useModeManager, useSave, useLassoMode } from 'dive-common/use';
import { provideAutoRegister } from 'dive-common/use/useAutoRegister';
import type {
  StereoAnnotationCompleteParams,
  StereoAnnotationResetParams,
  StereoSegmentationFinalizeParams,
} from 'dive-common/use/useModeManager';
import clientSettingsSetup, { clientSettings, isStereoInteractiveModeEnabled } from 'dive-common/store/settings';
import {
  useApi, FrameImage, DatasetType, AutoRegisterResponse,
} from 'dive-common/apispec';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import {
  buildAlignedTimeline, buildInverseAlignedIndex, computeGapSlots, TimelineResult,
} from 'dive-common/alignedTimeline';
import {
  computeOutputs,
  computeIsDefault,
  defaultImageEnhancements,
  effectiveImageEnhancements,
  ImageEnhancements,
  resolvePercentileStretchSupported,
  parseGirderHistogramResponse,
  girderHistogramToPercentileHistogram,
  PercentileHistogram,
  PercentileStretch,
} from 'vue-media-annotator/use/useImageEnhancements';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import context from 'dive-common/store/context';
import { MarkChangesPendingFilter } from 'vue-media-annotator/BaseFilterControls';
import GroupSidebarVue from './GroupSidebar.vue';
import MultiCamToolsVue from './MultiCamTools.vue';
import RegistrationToolsVue from './CameraRegistration/RegistrationTools.vue';
import MultiCamToolbar from './MultiCamToolbar.vue';
import AlignedViewToggle from './AlignedViewToggle.vue';
import PrimaryAttributeTrackFilter from './PrimaryAttributeTrackFilter.vue';
import UserSettingsDialog from './UserSettingsDialog.vue';

export interface ImageDataItem {
  url: string;
  filename: string;
}

const SIDEBAR_MODE_STORAGE_KEY = 'dive.viewer.sidebarMode';

export default defineComponent({
  components: {
    ControlsContainer,
    BottomPanel,
    DeleteControls,
    Sidebar,
    LayerManager,
    VideoAnnotator,
    ImageAnnotator,
    LargeImageAnnotator,
    ConfidenceFilter,
    UserGuideButton,
    UserSettingsDialog,
    EditorMenu,
    MultiCamToolbar,
    AlignedViewToggle,
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
    textQueryEnabled: {
      type: Boolean,
      default: false,
    },
    textQueryAvailable: {
      type: Boolean,
      default: false,
    },
    /**
     * Platform-supplied auto-register runner for the Camera Registration panel:
     * resolves each camera's image for a frame and computes an alignment via
     * the interactive service. Desktop-only; when null (web) the panel hides
     * its Auto Register button.
     */
    autoRegisterHandler: {
      type: Function as PropType<
        ((cameraA: string, cameraB: string, frameNum: number) => Promise<unknown>) | null>,
      default: null,
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
      setAlignedFrameResolver,
      setResetZoomOverride,
    } = useMediaController();
    const { time, updateTime, initialize: initTime } = useTimeObserver();
    const imageData = ref({ singleCam: [] } as Record<string, FrameImage[]>);
    const rawImageData = ref({ singleCam: [] } as Record<string, FrameImage[]>);
    const datasetType: Ref<DatasetType> = ref('image-sequence');
    const cameraTypesByCamera: Ref<Record<string, DatasetType>> = ref({});
    const datasetName = ref('');
    const subType = ref(null as string | null);
    const saveInProgress = ref(false);
    const videoUrl: Ref<Record<string, string>> = ref({});
    const {
      loadDetections, loadMetadata, saveMetadata, getTiles, getTileURL, getTileHistogram,
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
    /**
     * Global aligned-timeline resolution (SEAL feature 5, Phase II): only
     * engages when every camera in a multicam dataset has a timestamp on
     * every frame (see alignedTimeline.ts's canAlign). Otherwise -- including
     * always for singleCam datasets -- playback falls back to today's exact
     * positional (broadcast-same-index) behavior via useMediaController.ts.
     */
    const alignedTimeline = computed<TimelineResult>(() => {
      if (!progress.loaded || multiCamList.value.length < 2) {
        return { aligned: false };
      }
      // Only consider cameras that are actually part of this dataset:
      // imageData could retain keys from before the load (e.g. the initial
      // 'singleCam' entry), and a single leftover empty camera would make
      // canAlign() disqualify the whole dataset.
      const camerasFrames: Record<string, FrameImage[]> = {};
      multiCamList.value.forEach((camera) => {
        camerasFrames[camera] = imageData.value[camera] ?? [];
      });
      return buildAlignedTimeline(camerasFrames);
    });
    // Serialized shape of the currently installed timeline. The computed
    // re-evaluates whenever any camera's imageData array identity changes --
    // including pure display-URL swaps (e.g. the percentile-stretch remap)
    // that don't alter timestamps at all. Installing a new resolver re-seeks
    // every camera (a visible reload/blank flash), so skip the reinstall
    // when the slot structure is unchanged.
    let installedTimelineKey: string | null = null;
    watch(alignedTimeline, (result) => {
      const timelineKey = result.aligned ? JSON.stringify(result.slots) : null;
      if (timelineKey === installedTimelineKey) {
        return;
      }
      installedTimelineKey = timelineKey;
      if (result.aligned) {
        const inverseIndex = buildInverseAlignedIndex(result.slots);
        setAlignedFrameResolver({
          slotCount: computed(() => result.slots.length),
          frameRate: time.frameRate,
          resolveSlot: (f) => result.slots[f] ?? {},
          resolveGlobalSlot: (camera, localFrame) => inverseIndex[camera]?.get(localFrame),
          gapSlots: computed(() => computeGapSlots(result.slots)),
        });
      } else {
        setAlignedFrameResolver(null);
      }
    }, { immediate: true });
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

    /**
     * Forward a single-frame text query submission to the platform handler,
     * injecting the current frame number the query should run against.
     */
    function onTextQuerySubmit(
      payload: { text: string; boxThreshold: number; replaceExisting?: boolean },
    ) {
      emit('text-query-submit', {
        ...payload,
        frameNum: aggregateController.value.frame.value,
      });
    }

    const sideBarCollapsed = ref(false);
    // Sidebar mode: 'left', 'bottom', or 'collapsed'
    const getInitialSidebarMode = (): 'left' | 'bottom' | 'collapsed' => {
      const defaultMode = clientSettings.layoutSettings.sidebarPosition as 'left' | 'bottom' | 'collapsed';
      if (typeof window === 'undefined') {
        return defaultMode;
      }
      try {
        const saved = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
        if (saved === 'left' || saved === 'bottom' || saved === 'collapsed') {
          return saved;
        }
      } catch {
        // Ignore localStorage read failures and use default.
      }
      return defaultMode;
    };
    const sidebarMode = ref<'left' | 'bottom' | 'collapsed'>(getInitialSidebarMode());
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
    const showUserSettingsDialog = ref(false);

    // When the Camera Registration panel opens, minimize the workspace chrome to
    // give the picking view more room: collapse the left type-filter sidebar and
    // the bottom detections graph. This is a soft default -- the normal sidebar
    // and timeline toggles still work while registering, so the user can bring
    // either back -- and whatever layout they had before is restored on close.
    const registrationActive = computed(() => context.state.active === RegistrationToolsVue.name);
    let preRegistrationSidebarMode: 'left' | 'bottom' | 'collapsed' | null = null;
    let preRegistrationControlsCollapsed = false;
    watch(registrationActive, (active) => {
      if (active) {
        preRegistrationSidebarMode = sidebarMode.value;
        preRegistrationControlsCollapsed = controlsCollapsed.value;
        if (sidebarMode.value === 'left') {
          sidebarMode.value = 'collapsed';
        }
        controlsCollapsed.value = true;
      } else if (preRegistrationSidebarMode !== null) {
        sidebarMode.value = preRegistrationSidebarMode;
        controlsCollapsed.value = preRegistrationControlsCollapsed;
        preRegistrationSidebarMode = null;
      }
    });

    watch(sidebarMode, (mode) => {
      if (mode === 'left' || mode === 'bottom') {
        clientSettings.layoutSettings.sidebarPosition = mode;
      }
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, mode);
        } catch {
          // Ignore localStorage write failures.
        }
      }
    }, { immediate: true });

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
      imageEnhancementsByCamera,
      percentileStretchSupported,
      percentileHistogram,
      percentileHistogramLoading,
      setImageEnhancements,
      setSVGFilters,
      setPercentileStretchSupported,
      setPercentileHistogram,
      setPercentileHistogramLoading,
    } = useImageEnhancements();

    const isDesktopApp = typeof window !== 'undefined' && 'diveDesktop' in window;
    const supportsLargeImageTileStretch = !!getTileHistogram;
    const percentileStretchSupportedByCamera: Ref<Record<string, boolean>> = ref({});

    function cameraSupportsPercentileStretch(camera: string): boolean {
      return percentileStretchSupportedByCamera.value[camera] ?? false;
    }

    function syncPercentileStretchSupported(camera: string) {
      setPercentileStretchSupported(cameraSupportsPercentileStretch(camera));
    }

    const segmentationRecipe = new SegmentationPointClick();
    const segmentationCursorLoading = computed(
      () => segmentationRecipe.loading.value || segmentationRecipe.predicting.value,
    );
    const recipes = [
      new PolygonBase(),
      new HeadTail(),
      segmentationRecipe,
    ];

    const vuetify = inject('vuetify') as Vuetify;
    const trackStyleManager = new StyleManager({ markChangesPending, vuetify });
    const groupStyleManager = new StyleManager({ markChangesPending, vuetify });

    const cameraStore = new CameraStore({ markChangesPending });
    const isMultiCameraDataset = computed(() => multiCamList.value.length > 1);

    /**
     * Aligned view (SEAL-TK features 2 + 3): when every non-reference camera
     * has a usable transform into the reference camera's space, the user may
     * warp displays and link pan/zoom across all cameras during normal
     * review. Reference camera = the Reference Camera chosen at import
     * (stored as defaultDisplay), falling back to the first camera in
     * display order. Transforms come from the registration store's pair
     * homographies (picked in-app via the Camera Registration panel, or loaded
     * from a registration file or the dataset's saved meta), composed
     * through the pair graph -- the single registration the panel edits and
     * saves is exactly what the Align button applies.
     *
     * Store instances are always created (provideAnnotator runs before
     * loadData resolves), but watches, aligned navigation, and metadata
     * hydration only run for multicamera datasets.
     */
    const cameraRegistration = new CameraRegistrationStore();
    const alignedView = new AlignedViewStore();
    const referenceCamera = computed(() => {
      const cams = multiCamList.value;
      if (cams.length < 2) {
        return null;
      }
      return cams.includes(defaultCamera.value) ? defaultCamera.value : cams[0];
    });
    function resetMulticamAlignment() {
      alignedView.setEnabled(false);
      alignedView.setTransforms(null, null);
      alignedView.setRegistrationProgress(null);
      cameraRegistration.hydrate();
    }

    const alignedResolution = computed(() => {
      if (!isMultiCameraDataset.value) {
        return null;
      }
      const reference = referenceCamera.value;
      if (reference === null) {
        return null;
      }
      const toReference = resolveToReferenceTransforms(
        multiCamList.value,
        reference,
        cameraRegistration.homographies.value,
      );
      return toReference ? { reference, toReference } : null;
    });
    // Publish how much of the rig resolves so UI outside the viewer core
    // (e.g. the import menu's "Import to all cameras" checkbox) shows the
    // same "N/M cameras ready" status as the Align View toggle.
    const registrationProgress = computed(() => {
      if (!isMultiCameraDataset.value) {
        return null;
      }
      const cams = multiCamList.value;
      const reference = referenceCamera.value;
      if (reference === null) {
        return null;
      }
      const unresolved = unresolvedCameras(cams, reference, cameraRegistration.homographies.value);
      return { registered: cams.length - unresolved.length, total: cams.length };
    });
    watch([alignedResolution, referenceCamera], ([resolution, reference]) => {
      if (!isMultiCameraDataset.value) {
        return;
      }
      alignedView.setTransforms(
        reference,
        resolution?.toReference ?? null,
      );
    }, { immediate: true });
    watch(registrationProgress, (progressVal) => {
      if (!isMultiCameraDataset.value) {
        return;
      }
      alignedView.setRegistrationProgress(progressVal);
    }, { immediate: true });
    /**
     * Camera panes currently displayed. While the Camera Registration panel is
     * open with an active pair on a 3+ camera dataset, only the pair's two
     * panes show, so the left/right alignment flow reads without unrelated
     * panes in between (regardless of whether Edit points is toggled on).
     * Panes are hidden (v-show), not unmounted, so their viewers keep state.
     */
    const displayedCameras = computed(() => {
      const pair = cameraRegistration.activePair.value;
      if (registrationActive.value && pair) {
        const pairCameras = multiCamList.value.filter(
          (camera) => camera === pair.camA || camera === pair.camB,
        );
        if (pairCameras.length === 2) {
          return pairCameras;
        }
      }
      return multiCamList.value;
    });
    watch(displayedCameras, async () => {
      // Hidden/shown siblings change the remaining panes' sizes; resize the
      // geojs maps once the DOM has settled.
      await nextTick();
      handleResize();
    });
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

    const lassoMode = useLassoMode();
    provide(LassoModeSymbol, lassoMode);

    // Auto-register bridge for the Camera Registration panel: injects the current
    // frame into the platform handler (mirrors onTextQuerySubmit). Provided
    // unconditionally; `available` tracks the handler prop, which the desktop
    // platform sets once its availability probe resolves (never on web).
    provideAutoRegister({
      available: computed(() => !!props.autoRegisterHandler),
      run: (cameraA: string, cameraB: string) => {
        if (!props.autoRegisterHandler) {
          return Promise.reject(new Error('Auto-register is not available on this platform'));
        }
        return props.autoRegisterHandler(cameraA, cameraB, aggregateController.value.frame.value) as Promise<AutoRegisterResponse>;
      },
    });

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
      alignedView,
      isStereoscopicDataset: computed(() => subType.value === 'stereo'),
      onStereoAnnotationComplete: (params: StereoAnnotationCompleteParams) => {
        emit('stereo-annotation-complete', params);
      },
      onStereoAnnotationReset: (params: StereoAnnotationResetParams) => {
        emit('stereo-annotation-reset', params);
      },
      onStereoSegmentationFinalize: (params?: StereoSegmentationFinalizeParams) => {
        emit('stereo-segmentation-finalize', params);
      },
    });

    // Register linked-viewer composables during setup (after selectedCamera exists)
    // so their onBeforeUnmount hooks attach to Viewer. Calling them from async
    // loadData() left pan/zoom listeners without teardown and triggered Vue's
    // "no active component instance" warning.
    useAlignedNavigation(aggregateController, alignedView, multiCamList, {
      selectedCamera,
      setResetZoomOverride,
    });
    useRegistrationNavigation(aggregateController, cameraRegistration, alignedView);
    watch(cameraRegistration.pickingEnabled, (picking) => {
      alignedView.setSuspended(picking);
    }, { immediate: true });

    /**
     * Every camera pane calls updateTime() from its own seek/play/pause, but
     * useTime()'s frame/flick is a single shared value consumed app-wide as
     * "the current frame" (track split, keyframe toggling, attribute editing,
     * etc.). Under an aligned timeline (SEAL feature 5) cameras can sit on
     * different local frames for the same instant, so only the selected
     * camera's updates may reach it -- otherwise whichever camera's annotator
     * happened to seek last would silently win, regardless of which camera
     * the user is actually looking at/editing.
     */
    function selectedCameraUpdateTime(camera: string): SetTimeFunc {
      return (data) => {
        if (selectedCamera.value === camera) {
          updateTime(data);
        }
      };
    }

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

      // In interactive stereo mode, a freshly linked pair should get its stereo
      // measurement (length, midpoint, range, RMS) computed for every frame
      // where both cameras now have a line. The desktop loader owns the stereo
      // service, so delegate via an event.
      if (isStereoInteractiveModeEnabled() && subType.value === 'stereo') {
        emit('stereo-track-linked', baseTrack);
      }
    }
    watch(linkingTrack, () => {
      if (linkingTrack.value !== null && selectedTrackId.value !== null) {
        linkCameraTrack(selectedTrackId.value, linkingTrack.value, linkingCamera.value);
        handler.stopLinking();
      }
    });
    async function save(setVal?: string, exitEditingMode = true) {
      // Manual save exits editing by default; auto-save opts out.
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
          timeFilters: trackFilters.timeFilters.value,
          imageEnhancements: imageEnhancements.value,
          // TODO Group confidence filters are not yet supported.
        }, saveSet);
      } catch (err) {
        let text = 'Unable to Save Data';
        const saveErr = err as { response?: { status?: number } };
        if (saveErr.response && saveErr.response.status === 403) {
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

    function saveTimeFilter() {
      saveMetadata(datasetId.value, {
        timeFilters: trackFilters.timeFilters.value,
      });
    }

    const debouncedSaves: Record<string, ReturnType<typeof debounce>> = {};

    function getCameraId(camera: string): string {
      return multiCamList.value.length > 1
        ? `${baseMulticamDatasetId.value}/${camera}`
        : datasetId.value;
    }

    function getDebouncedSave(camera: string) {
      if (!debouncedSaves[camera]) {
        debouncedSaves[camera] = debounce(
          () => saveMetadata(
            getCameraId(camera),
            { imageEnhancements: imageEnhancementsByCamera.value[camera] },
          ),
          1000,
          { trailing: true },
        );
      }
      return debouncedSaves[camera];
    }

    function toDisplayUrl(
      rawUrl: string,
      camera: string,
      frame: number,
      low: number,
      high: number,
    ): string {
      // The backend resolves the ORIGINAL source image from (dataset id, frame index)
      // rather than the transcoded path in rawUrl, so it can stretch the original 16-bit
      // TIFF instead of the 8-bit PNG that import-time transcoding produced.
      // For desktop the raw URL is absolute (http://127.0.0.1:PORT/api/media?path=...).
      // Reuse its origin so requests go directly to the Express backend, not through the
      // Vite proxy which doesn't know the randomly-assigned backend port.
      let apiBase = '/api';
      try {
        const parsed = new URL(rawUrl);
        apiBase = `${parsed.origin}/api`;
      } catch { /* rawUrl is relative (web platform) — keep /api */ }
      const id = encodeURIComponent(getCameraId(camera));
      return `${apiBase}/media/display?id=${id}&frame=${frame}&low=${low}&high=${high}`;
    }

    function toHistogramUrl(
      rawUrl: string,
      camera: string,
      frame: number,
      low: number,
      high: number,
    ): string {
      let apiBase = '/api';
      try {
        const parsed = new URL(rawUrl);
        apiBase = `${parsed.origin}/api`;
      } catch { /* rawUrl is relative (web platform) — keep /api */ }
      const id = encodeURIComponent(getCameraId(camera));
      return `${apiBase}/media/histogram?id=${id}&frame=${frame}&low=${low}&high=${high}`;
    }

    const previousStretchByCam: Record<string, string> = {};

    function stretchKey(camera: string): string {
      const enh = imageEnhancementsByCamera.value[camera];
      const effective = effectiveImageEnhancements(
        enh ?? defaultImageEnhancements,
        cameraSupportsPercentileStretch(camera),
      );
      const s = effective.percentileStretch;
      return s ? `${s.lowPercentile}:${s.highPercentile}` : 'none';
    }

    function applyDisplayUrls(camera: string) {
      const raw = rawImageData.value[camera] ?? [];
      const enh = imageEnhancementsByCamera.value[camera];
      const effective = effectiveImageEnhancements(
        enh ?? defaultImageEnhancements,
        cameraSupportsPercentileStretch(camera),
      );
      let frames: FrameImage[];
      if (effective.percentileStretch) {
        const { lowPercentile, highPercentile } = effective.percentileStretch;
        frames = raw.map((item, index) => ({
          ...item,
          url: toDisplayUrl(item.url, camera, index, lowPercentile, highPercentile),
        }));
      } else {
        frames = raw;
      }
      if (imageData.value[camera] !== frames) {
        VueSet(imageData.value, camera, frames);
      }
      previousStretchByCam[camera] = stretchKey(camera);
    }

    let histogramRequestToken = 0;

    async function fetchSelectedCameraHistogram() {
      const camera = selectedCamera.value;
      const frame = time.frame.value;
      const rawFrames = rawImageData.value[camera] ?? [];
      if (!progress.loaded || !cameraSupportsPercentileStretch(camera) || frame < 0 || frame >= rawFrames.length) {
        histogramRequestToken += 1;
        setPercentileHistogram(null);
        setPercentileHistogramLoading(false);
        return;
      }
      const rawFrame = rawFrames[frame];
      if (!rawFrame?.url) {
        histogramRequestToken += 1;
        setPercentileHistogram(null);
        setPercentileHistogramLoading(false);
        return;
      }
      const requestToken = histogramRequestToken + 1;
      histogramRequestToken = requestToken;
      setPercentileHistogramLoading(true);
      try {
        const cameraType = cameraTypesByCamera.value[camera] ?? datasetType.value;
        if (cameraType === 'large-image' && rawFrame.id && getTileHistogram) {
          const response = await getTileHistogram(rawFrame.id, { bins: 256 });
          if (histogramRequestToken !== requestToken) return;
          setPercentileHistogram(
            girderHistogramToPercentileHistogram(parseGirderHistogramResponse(response)),
          );
          return;
        }
        // Bins depend only on the source frame; percentile markers are derived client-side.
        const response = await fetch(toHistogramUrl(rawFrame.url, camera, frame, 1, 99));
        if (!response.ok) {
          throw new Error(`Histogram request failed with status ${response.status}`);
        }
        const payload = await response.json() as PercentileHistogram;
        if (histogramRequestToken !== requestToken) return;
        setPercentileHistogram(payload);
      } catch {
        if (histogramRequestToken !== requestToken) return;
        setPercentileHistogram(null);
      } finally {
        if (histogramRequestToken === requestToken) {
          setPercentileHistogramLoading(false);
        }
      }
    }

    const debouncedApplyUrlsByCam: Record<string, ReturnType<typeof debounce>> = {};
    const debouncedFetchHistogram = debounce(fetchSelectedCameraHistogram, 200, { trailing: true });

    function getDebouncedApplyDisplayUrls(camera: string) {
      if (!debouncedApplyUrlsByCam[camera]) {
        debouncedApplyUrlsByCam[camera] = debounce(applyDisplayUrls, 500, { trailing: true });
      }
      return debouncedApplyUrlsByCam[camera];
    }

    watch(imageEnhancements, () => {
      const camera = selectedCamera.value;
      VueSet(imageEnhancementsByCamera.value, camera, imageEnhancements.value);
      getDebouncedSave(camera)();

      const current = stretchKey(camera);
      const previous = previousStretchByCam[camera] ?? 'none';
      if (current !== previous) {
        const isToggle = (current === 'none') !== (previous === 'none');
        if (isToggle) {
          getDebouncedApplyDisplayUrls(camera).cancel();
          applyDisplayUrls(camera);
        } else {
          getDebouncedApplyDisplayUrls(camera)(camera);
        }
      }
    }, { deep: true });

    watch(selectedCamera, (newCam, oldCam) => {
      debouncedSaves[oldCam]?.flush();
      debouncedFetchHistogram.cancel();
      setImageEnhancements(
        imageEnhancementsByCamera.value[newCam] ?? { ...defaultImageEnhancements },
      );
      syncPercentileStretchSupported(newCam);
      fetchSelectedCameraHistogram().catch(() => {});
      // cancel the save that watch(imageEnhancements) schedules when setImageEnhancements
      // replaces the ref — loading a camera's stored state is not a user-initiated change
      nextTick(() => { debouncedSaves[newCam]?.cancel(); });
    });

    watch(
      [() => time.frame.value, percentileStretchSupported],
      () => { debouncedFetchHistogram(); },
    );

    // Auto-save annotations when enabled, but never while editing a track.
    // Delay is configurable in settings and applied dynamically.
    const getAutoSaveDelayMs = () => (
      Math.max(10, Number(clientSettings.autoSaveSettings.delaySeconds) || 60) * 1000
    );
    let debouncedAutoSave = debounce(
      async () => {
        if (readonlyState.value) return;
        if (editingTrack.value) return;
        if (pendingSaveCount.value === 0) return;
        if (saveInProgress.value) return;
        await save(props.currentSet, false);
      },
      getAutoSaveDelayMs(),
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
          && !editingTrack.value
        ) {
          debouncedAutoSave();
        }
      },
    );

    // Flush pending edits once an in-flight save settles.
    watch(saveInProgress, (nowSaving, wasSaving) => {
      if (
        wasSaving
        && !nowSaving
        && clientSettings.autoSaveSettings.enabled
        && pendingSaveCount.value > 0
        && !readonlyState.value
        && !editingTrack.value
      ) {
        debouncedAutoSave();
      }
    });

    watch(editingTrack, (isEditing) => {
      if (isEditing) {
        debouncedAutoSave.cancel();
        return;
      }
      if (
        clientSettings.autoSaveSettings.enabled
        && pendingSaveCount.value > 0
        && !readonlyState.value
      ) {
        debouncedAutoSave();
      }
    });

    watch(() => clientSettings.autoSaveSettings.delaySeconds, () => {
      debouncedAutoSave.cancel();
      debouncedAutoSave = debounce(
        async () => {
          if (readonlyState.value) return;
          if (editingTrack.value) return;
          if (pendingSaveCount.value === 0) return;
          if (saveInProgress.value) return;
          await save(props.currentSet, false);
        },
        getAutoSaveDelayMs(),
        { trailing: true, leading: false },
      );
      if (
        clientSettings.autoSaveSettings.enabled
        && pendingSaveCount.value > 0
        && !readonlyState.value
        && !editingTrack.value
      ) {
        debouncedAutoSave();
      }
    });

    // Navigation Guards used by parent component
    /**
     * Unsaved work the exit/navigation guards protect: pending annotation
     * saves, plus Camera Registration panel edits, which track their own
     * dirty state (they persist through dataset meta, outside the
     * annotation save path that pendingSaveCount counts).
     */
    const hasUnsavedChanges = computed(
      () => pendingSaveCount.value > 0 || cameraRegistration.dirty.value,
    );
    /**
     * Persist unsaved Camera Registration panel edits -- the same write as
     * the panel's own Save button -- so the desktop close guard's "Save"
     * choice covers them too. No-op while the registration is clean.
     */
    async function saveRegistration() {
      if (!cameraRegistration.dirty.value) {
        return;
      }
      cameraRegistration.maybeFitActivePair();
      await saveMetadata(datasetId.value, {
        cameraHomographies: cameraRegistration.homographies.value,
        cameraCorrespondences: cameraRegistration.correspondences.value,
        cameraTransformTypes: cameraRegistration.transformTypes.value,
        cameraRegistrationSource: cameraRegistration.source.value,
      });
      cameraRegistration.markSaved();
    }
    async function warnBrowserExit(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges.value) return;
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      event.returnValue = '';
    }
    async function navigateAwayGuard(): Promise<boolean> {
      let result = true;
      if (hasUnsavedChanges.value) {
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

    const selectCamera = async (camera: string, editMode = false, preserveSelection = false) => {
      if (linkingCamera.value !== '' && linkingCamera.value !== camera) {
        await prompt({
          title: 'In Linking Mode',
          text: ['Currently in Linking Mode, please hit OK and Escape to exit',
            'Linking mode or choose another Track in the highlighted Camera to Link'],
          positiveButton: 'OK',
        });
        return;
      }
      // Segmentation prompt points belong to the current camera's image: lock
      // in any pending mask (committed to the still-selected camera) and clear
      // the points before switching, so they cannot leak into a prediction on
      // the new camera. No-op when nothing is pending.
      if (selectedCamera.value !== camera) {
        handler.segmentationFinalizePending();
      }
      // EditTrack is set false by the LayerMap before executing this.
      // Skip during cross-camera continuation (preserveSelection): the source
      // camera's track is legitimately empty because the geometry is being
      // drawn on the target camera under the same track id. Aborting here would
      // remove that track and null selectedTrackId, so the in-progress draw
      // would then commit with no selected track and throw.
      if (!preserveSelection && selectedTrackId.value !== null) {
        // If we had a track selected and it still exists with
        // a feature length of 0 we need to remove it
        const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
        if (track && track.features.length === 0) {
          handler.trackAbort();
        }
      }
      selectedCamera.value = camera;
      // Immediately resync the shared time observer to the newly selected
      // camera's own local frame (see selectedCameraUpdateTime) -- otherwise
      // it would keep reporting the previously selected camera's local frame
      // until the next seek/play/pause happens to land on this camera.
      // During load (loadData calls changeCamera before progress.loaded, so
      // no annotator has mounted yet) there is no controller for the camera:
      // skip the resync gracefully -- the annotator syncs time on mount.
      try {
        const newCameraController = aggregateController.value.getController(camera);
        updateTime({ frame: newCameraController.frame.value, flick: newCameraController.flick.value });
      } catch {
        // No controller registered for this camera (yet); nothing to resync.
      }
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
    // While drawing a brand-new detection (selected track has no geometry yet on
    // this frame), the user may start the draw on any camera. Detect that so the
    // camera-view mousedown doesn't steal the draw — preventDefault would kill a
    // rectangle's mousedown-drag. The draw is routed to the drawn-on camera in
    // LayerManager's update:geojson handler instead.
    const isCreatingNewDetection = (): boolean => {
      if (selectedTrackId.value === null || !editingTrack.value) {
        return false;
      }
      const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
      if (!track) {
        return false;
      }
      // Must use selectedCamera's own local frame, not aggregateController's
      // frame: under an aligned timeline (SEAL feature 5) the aggregate frame
      // is the global slot index, which diverges from any camera's local
      // frame -- and getFeature() is keyed by local frame, same as tracks are
      // stored. See LayerManager.vue's identically-named helper.
      let cameraFrame: number;
      try {
        cameraFrame = aggregateController.value.getController(selectedCamera.value).frame.value;
      } catch {
        // This camera's annotator never mounted (e.g. mid load/reload); fall
        // back to the aggregate frame rather than throwing.
        cameraFrame = aggregateController.value.frame.value;
      }
      return track.getFeature(cameraFrame)[0] == null;
    };
    // While editing, the creation cursor is live on any camera still missing
    // the selected track's geometry at this frame (see LayerManager's
    // cameraAwaitingGeometry, which this must mirror), so the detection can
    // be drawn on each camera in turn without switching first. A left-click
    // on such a camera is the start of that draw -- don't steal it to switch
    // cameras. For Point mode (point-click segmentation) and Polygon mode,
    // "missing" means no polygon at the selected key here yet, so a box-only
    // detection still accepts a draw.
    const isExtendingDetectionToCamera = (camera: string): boolean => {
      if (selectedTrackId.value === null || !editingTrack.value) {
        return false;
      }
      const editingType = editingMode.value;
      if (!editingType) {
        return false;
      }
      const track = cameraStore.getPossibleTrack(selectedTrackId.value, camera);
      if (!track) {
        return true;
      }
      // Must use this camera's own local frame, not aggregateController's
      // frame: under an aligned timeline the aggregate frame is the global
      // slot index, which diverges from any camera's local frame -- and
      // getFeature() is keyed by local frame. Same pattern as
      // isCreatingNewDetection above.
      let cameraFrame: number;
      try {
        cameraFrame = aggregateController.value.getController(camera).frame.value;
      } catch {
        cameraFrame = aggregateController.value.frame.value;
      }
      const [feature] = track.getFeature(cameraFrame);
      if (feature == null) {
        return true;
      }
      if (editingType === 'Point' || editingType === 'Polygon') {
        return !featureHasSegmentationPolygon(feature, selectedKey.value);
      }
      return false;
    };
    // Handles changing camera using the dropdown or mouse clicks
    // When using mouse clicks and right button it will remain in edit mode for the selected track
    const changeCamera = (camera: string, event?: MouseEvent) => {
      if (selectedCamera.value === camera) {
        return;
      }
      // Don't intercept clicks mid-creation; let the draw land on this camera.
      // The draw is routed to the drawn-on camera in LayerManager's update handler.
      if (isCreatingNewDetection()) {
        return;
      }
      // Likewise, when a camera is still missing the selected track's
      // geometry its creation cursor is live (see LayerManager): a left-click
      // there starts a draw and a right-click cancels creation -- finalize
      // what was committed and deselect, exactly like the single-camera
      // behavior (the edit layer's own right-click handler does this).
      // Neither must be stolen to switch cameras: switching mid-draw runs
      // trackEdit -> finalizeInProgress, which interrupts the in-progress
      // line instead of finalizing the detection. The dropdown (no event) is
      // unaffected.
      if (event && isExtendingDetectionToCamera(camera)) {
        return;
      }
      // A right-click while editing must finalize and deselect the detection
      // in a single press -- matching single-camera behavior -- not merely
      // switch cameras (which used to leave the detection selected until a
      // second right-click on the new camera). Right-clicks ON an annotation
      // never reach here: the annotation layers' right-click handoff switches
      // the selected camera synchronously first, so this handler returns at
      // the top (same camera).
      if (event?.button === 2 && editingTrack.value) {
        handler.trackSelect(null, false);
        return;
      }
      // While editing a track that exists on the target camera, its edit
      // handles are live there too (see LayerManager): this mousedown may be
      // the start of a handle drag, which preventDefault would kill. The
      // switch still proceeds so the edit commits to the target camera.
      const editingOnTarget = editingTrack.value && selectedTrackId.value !== null
        && !!cameraStore.getPossibleTrack(selectedTrackId.value, camera);
      if (event && !editingOnTarget) {
        event.preventDefault();
      }
      // Left click should kick out of editing mode, unless the selected track
      // exists on the target camera (e.g. a stereo-warped annotation) — in that
      // case preserve editing so the user can immediately adjust it.
      if (event?.button === 0) {
        if (selectedTrackId.value !== null) {
          const targetTrack = cameraStore.getPossibleTrack(selectedTrackId.value, camera);
          if (!targetTrack) {
            editingTrack.value = false;
          }
        } else {
          editingTrack.value = false;
        }
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
        baseMulticamDatasetId.value = datasetId.value;
        if (meta.multiCamMedia) {
          /* We're loading a multicamera dataset */
          multiCamList.value = orderedMultiCamCameraNames(meta.multiCamMedia);
          defaultCamera.value = meta.multiCamMedia.defaultDisplay;
          changeCamera(defaultCamera.value);
          baseMulticamDatasetId.value = datasetId.value;
          if (!selectedCamera.value) {
            throw new Error('Multicamera dataset without default camera specified.');
          }
        } else {
          multiCamList.value = ['singleCam'];
          resetMulticamAlignment();
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
          loadAttributes(meta.attributes, { enableStereoLengthRender: meta.subType === 'stereo' });
        }
        trackFilters.setConfidenceFilters(meta.confidenceFilters);
        trackFilters.setTimeFilters(meta.timeFilters ?? null);
        /* imageEnhancements are loaded per-camera below */
        datasetName.value = meta.name;
        subType.value = meta.subType || null;
        datasetType.value = meta.type as DatasetType;
        initTime({
          frameRate: meta.fps,
          originalFps: meta.originalFps || null,
        });
        // Rebuild imageData with exactly this dataset's cameras, dropping the
        // initial 'singleCam' placeholder (on multicam datasets) and any
        // previous dataset's leftovers. A stale empty entry would make
        // alignedTimeline's canAlign() disqualify the dataset. Replacing the
        // whole object (rather than adding keys with bracket assignment,
        // which is non-reactive for new keys under Vue 2.7) also keeps the
        // alignedTimeline computed and the template reactive to these keys.
        imageData.value = Object.fromEntries(
          multiCamList.value.map((camera) => [camera, [] as FrameImage[]]),
        );
        for (let i = 0; i < multiCamList.value.length; i += 1) {
          const camera = multiCamList.value[i];
          let cameraId = baseMulticamDatasetId.value;
          if (multiCamList.value.length > 1) {
            cameraId = `${baseMulticamDatasetId.value}/${camera}`;
          }
          // eslint-disable-next-line no-await-in-loop
          const subCameraMeta = await loadMetadata(cameraId);
          VueSet(cameraTypesByCamera.value, camera, subCameraMeta.type as DatasetType);
          if (multiCamList.value.length <= 1) {
            datasetType.value = subCameraMeta.type as DatasetType;
          }

          VueSet(imageEnhancementsByCamera.value, camera, subCameraMeta.imageEnhancements
            ? { ...subCameraMeta.imageEnhancements as ImageEnhancements }
            : { ...defaultImageEnhancements });
          VueSet(
            percentileStretchSupportedByCamera.value,
            camera,
            resolvePercentileStretchSupported(
              subCameraMeta,
              isDesktopApp,
              supportsLargeImageTileStretch,
            ),
          );
          VueSet(rawImageData.value, camera, cloneDeep(subCameraMeta.imageData) as FrameImage[]);
          applyDisplayUrls(camera);
          if (subCameraMeta.videoUrl) {
            videoUrl.value[camera] = subCameraMeta.videoUrl;
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
        // Rehydrate any saved camera-to-camera registration homographies, points,
        // transform types, and producer provenance (multicamera only).
        if (isMultiCameraDataset.value) {
          cameraRegistration.hydrate(
            meta.cameraHomographies,
            meta.cameraCorrespondences,
            meta.cameraTransformTypes,
            meta.cameraRegistrationSource,
          );
          // Reset the aligned-view toggle for the newly loaded dataset (no
          // persistence this phase).
          alignedView.setEnabled(false);
        }
        setImageEnhancements(
          imageEnhancementsByCamera.value[selectedCamera.value] ?? { ...defaultImageEnhancements },
        );
        syncPercentileStretchSupported(selectedCamera.value);
        progress.loaded = true;
        fetchSelectedCameraHistogram().catch(() => {});
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
          context.register({
            component: RegistrationToolsVue,
            description: 'Camera Registration',
          });
        } else {
          context.unregister({
            component: MultiCamToolsVue,
            description: 'Multi Camera Tools',
          });
          context.unregister({
            component: RegistrationToolsVue,
            description: 'Camera Registration',
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
      Object.values(debouncedSaves).forEach((fn) => fn.cancel());
      Object.keys(debouncedSaves).forEach((k) => delete debouncedSaves[k]);
      Object.values(debouncedApplyUrlsByCam).forEach((fn) => fn.cancel());
      Object.keys(debouncedApplyUrlsByCam).forEach((k) => delete debouncedApplyUrlsByCam[k]);
      Object.keys(previousStretchByCam).forEach((k) => delete previousStretchByCam[k]);
      imageEnhancementsByCamera.value = {};
      cameraTypesByCamera.value = {};
      percentileStretchSupportedByCamera.value = {};
      setPercentileStretchSupported(false);
      setPercentileHistogram(null);
      setPercentileHistogramLoading(false);
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
    // Opening/closing the context sidebar shrinks or widens the camera panes,
    // but nothing else notices: the only ResizeObserver watches the controls
    // bar, which is position:absolute in side layout and so keeps its content
    // width when the panes resize. Trigger a resize explicitly so the panes'
    // GeoJS size() stays in sync (an unnoticed shrink leaves content anchored
    // in a corner).
    watch([controlsCollapsed, sidebarMode, () => context.state.active], async () => {
      await nextTick();
      handleResize();
    });
    onBeforeUnmount(() => {
      debouncedAutoSave.cancel();
      Object.values(debouncedApplyUrlsByCam).forEach((fn) => fn.cancel());
      debouncedFetchHistogram.cancel();
      Object.values(debouncedSaves).forEach((fn) => fn.flush());
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
        cameraRegistration,
        alignedView,
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
        segmentationCursorLoading,
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
        percentileStretchSupported,
        percentileHistogram,
        percentileHistogramLoading,
      },
      globalHandler,
      useAttributeFilters,
    );

    const disableAnnotationFilters = computed(() => (
      trackFilters.disableAnnotationFilters.value
    ));
    const saveTooltipText = computed(() => {
      if (readonlyState.value) {
        return 'Read only mode, cannot save changes';
      }
      if (saveInProgress.value) {
        return 'Saving changes...';
      }
      const changeLabel = pendingSaveCount.value === 1 ? 'change' : 'changes';
      let tooltip = `Save ${pendingSaveCount.value} ${changeLabel}`;
      if (clientSettings.autoSaveSettings.enabled) {
        tooltip += `. Auto-save is on (delay: ${clientSettings.autoSaveSettings.delaySeconds} seconds)`;
      }
      return tooltip;
    });
    const showMultiCamToolbar = computed(() => (
      typeof window !== 'undefined'
      && multiCamList.value.length > 1
      && clientSettings.multiCamSettings.showToolbar
    ));

    function seekToFrame(frame: number) {
      // `frame` arrives in the selected camera's own local frame space (track
      // begin/end from TrackItem/TrackList/TrackDetailsPanel, keyframe
      // navigation, BottomPanel...). Under an aligned timeline (SEAL feature
      // 5) the aggregate seek() expects a global slot index, so translate via
      // seekCameraFrame -- a passthrough when alignment isn't active.
      try {
        aggregateController.value.seekCameraFrame(selectedCamera.value, frame);
      } catch {
        // Ignore seek requests while controllers are initializing.
      }
    }

    function resetAggregateZoom() {
      try {
        aggregateController.value.resetZoom();
      } catch {
        // Ignore reset requests while controllers are initializing.
      }
    }

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

    function cameraAnnotatorComponent(camera: string): string {
      const type = cameraTypesByCamera.value[camera] ?? datasetType.value;
      if (type === 'image-sequence') {
        return 'image-annotator';
      }
      if (type === 'video') {
        return 'video-annotator';
      }
      return 'large-image-annotator';
    }

    function cameraEnhOutputs(camera: string) {
      return computeOutputs(
        imageEnhancementsByCamera.value[camera] ?? defaultImageEnhancements,
      );
    }

    function isCameraDefault(camera: string): boolean {
      return computeIsDefault(
        effectiveImageEnhancements(
          imageEnhancementsByCamera.value[camera] ?? defaultImageEnhancements,
          cameraSupportsPercentileStretch(camera),
        ),
      );
    }

    function cameraPercentileStretch(camera: string): PercentileStretch | null {
      const effective = effectiveImageEnhancements(
        imageEnhancementsByCamera.value[camera] ?? defaultImageEnhancements,
        cameraSupportsPercentileStretch(camera),
      );
      return effective.percentileStretch ?? null;
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
      onTextQuerySubmit,
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
      cameraAnnotatorComponent,
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
      lassoModeActive: lassoMode.lassoModeActive,
      lassoDrawing: lassoMode.lassoDrawing,
      pendingSaveCount,
      progress,
      progressValue,
      saveInProgress,
      showUserSettingsDialog,
      playbackComponent,
      recipes,
      segmentationRecipe,
      selectedFeatureHandle,
      selectedTrackId,
      editingGroupId,
      selectedKey,
      trackFilters,
      videoUrl,
      visibleModes,
      frameRate: time.frameRate,
      originalFps: time.originalFps,
      context,
      readonlyState,
      cameraEnhOutputs,
      isCameraDefault,
      cameraPercentileStretch,
      disableAnnotationFilters,
      trackStyleManager,
      visible,
      selectedTrackForDetails,
      showConfidenceFirst,
      showTrackAttributesFirst,
      attributes,
      datasetId,
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
      saveTooltipText,
      showMultiCamToolbar,
      displayedCameras,
      seekToFrame,
      resetAggregateZoom,
      /* large image methods */
      getTiles,
      getTileURL,
      /* methods */
      handler: globalHandler,
      save,
      saveThreshold,
      saveTimeFilter,
      selectedCameraUpdateTime,
      // multicam
      multiCamList,
      defaultCamera,
      selectedCamera,
      changeCamera,
      // For Navigation Guarding
      navigateAwayGuard,
      warnBrowserExit,
      hasUnsavedChanges,
      saveRegistration,
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
        <slot name="dataset-name-prefix" />
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
            lassoModeActive: !readonlyState && lassoModeActive,
            lassoDrawing: !readonlyState && lassoDrawing,
            textQueryEnabled,
            textQueryAvailable,
          }"
          :tail-settings.sync="clientSettings.annotatorPreferences.trackTails"
          :show-user-created-icon.sync="clientSettings.annotatorPreferences.showUserCreatedIcon"
          @set-annotation-state="handler.setAnnotationState"
          @exit-edit="handler.trackAbort"
          @text-query-init="$emit('text-query-init')"
          @text-query="onTextQuerySubmit"
          @text-query-all-frames="$emit('text-query-all-frames', $event)"
          @open-external-link="$emit('open-external-link', $event)"
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
            v-if="showMultiCamToolbar && multiCamList.length > 1 && clientSettings.multiCamSettings.showToolbar && selectedCamera === multiCamList[0]"
            slot="multicam-controls-left"
          >
            <multi-cam-toolbar />
          </template>
          <template
            v-if="showMultiCamToolbar && multiCamList.length > 1 && clientSettings.multiCamSettings.showToolbar && selectedCamera !== multiCamList[0]"
            slot="multicam-controls-right"
          >
            <multi-cam-toolbar />
          </template>
        </EditorMenu>
        <v-select
          v-if="showMultiCamToolbar && multiCamList.length > 1"
          :value="selectedCamera"
          :items="multiCamList"
          label="Camera"
          class="mx-1 shrink camera-select"
          :menu-props="{ minWidth: 140 }"
          outlined
          hide-details
          dense
          variant="default"
          @change="changeCamera"
        >
          <template #item="{ item }">
            {{ item }} {{ item === defaultCamera ? '(Default)' : '' }}
          </template>
        </v-select>
        <aligned-view-toggle v-if="multiCamList.length > 1" />

        <slot name="extension-right" />

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
              @click="context.toggle(undefined)"
            >
              {{ context.state.active ? 'mdi-chevron-right-box' : 'mdi-chevron-left-box' }}
            </v-icon>
          </template>
          <span>Menus for Advanced Tools/Settings</span>
        </v-tooltip>
      </template>

      <slot name="title-right" />
      <user-guide-button annotating />
      <v-tooltip bottom>
        <template #activator="{ on }">
          <div v-on="on">
            <v-btn
              icon
              @click="showUserSettingsDialog = true"
            >
              <v-icon>mdi-cog</v-icon>
            </v-btn>
          </div>
        </template>
        <span>User settings</span>
      </v-tooltip>

      <v-tooltip
        bottom
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
            <v-btn
              icon
              :disabled="readonlyState || pendingSaveCount === 0 || saveInProgress"
              v-on="on"
              @click="save(currentSet)"
            >
              <v-icon :class="{ 'mdi-spin': saveInProgress }">
                {{
                  saveInProgress
                    ? 'mdi-loading'
                    : (clientSettings.autoSaveSettings.enabled ? 'mdi-content-save-cog' : 'mdi-content-save')
                }}
              </v-icon>
            </v-btn>
          </v-badge>
        </template>
        <span>
          {{ saveTooltipText }}
        </span>
      </v-tooltip>
    </v-app-bar>
    <UserSettingsDialog
      :value="showUserSettingsDialog"
      @input="showUserSettingsDialog = $event"
    />

    <!-- Standard layout (left sidebar visible or hidden) -->
    <v-row
      v-if="sidebarMode === 'left' || sidebarMode === 'collapsed'"
      no-gutters
      class="fill-height"
      style="min-width: 700px;"
    >
      <sidebar
        v-if="sidebarMode === 'left'"
        :is-stereo-dataset="subType === 'stereo'"
        @import-types="trackFilters.importTypes($event)"
        @track-seek="seekToFrame($event)"
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
            { bind: 'r', handler: () => resetAggregateZoom() },
            { bind: 'esc', handler: () => handler.trackAbort() },
            { bind: 'e', handler: () => multiCamList.length === 1 && selectedTrackId !== null && handler.trackEdit(selectedTrackId) },
          ]"
          class="d-flex flex-column grow"
        >
          <div class="d-flex grow">
            <!--
              Hidden panes swap to Vuetify's d-none instead of using v-show:
              d-flex is `display: flex !important`, which defeats v-show's
              inline `display: none`. Panes stay mounted either way, so their
              viewers keep state.
            -->
            <div
              v-for="camera in multiCamList"
              :key="camera"
              :class="displayedCameras.includes(camera) ? 'd-flex flex-column grow' : 'd-none'"
              :style="{ height: `calc(100% - ${controlsHeight}px)` }"
              @mousedown.left="changeCamera(camera, $event)"
              @mouseup.right="changeCamera(camera, $event)"
            >
              <component
                :is="cameraAnnotatorComponent(camera)"
                v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
                ref="subPlaybackComponent"
                class="fill-height"
                :class="{ 'selected-camera': selectedCamera === camera && camera !== 'singleCam' }"
                v-bind="{
                  imageData: imageData[camera],
                  videoUrl: videoUrl[camera],
                  updateTime: selectedCameraUpdateTime(camera),
                  frameRate,
                  originalFps,
                  camera,
                  imageEnhancementOutputs: cameraEnhOutputs(camera),
                  isDefaultImage: isCameraDefault(camera),
                  getTiles,
                  getTileURL,
                  percentileStretch: cameraPercentileStretch(camera),
                  filterId: `imageEnhancements-${camera}`,
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
              lineChartData, eventChartData, groupChartData, datasetType, isDefaultImage: isCameraDefault(selectedCamera),
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

    <!-- Bottom sidebar layout -->
    <div
      v-else-if="sidebarMode === 'bottom'"
      class="d-flex flex-column fill-height"
      style="min-width: 700px;"
    >
      <div class="d-flex grow" style="min-height: 0;">
        <div
          v-if="progress.loaded"
          v-mousetrap="[
            { bind: 'n', handler: () => !readonlyState && handler.trackAdd() },
            { bind: 'r', handler: () => resetAggregateZoom() },
            { bind: 'esc', handler: () => handler.trackAbort() },
            { bind: 'e', handler: () => multiCamList.length === 1 && selectedTrackId !== null && handler.trackEdit(selectedTrackId) },
            { bind: 'a', handler: () => sidebarMode === 'bottom' && toggleBottomRightPanel() },
          ]"
          class="d-flex flex-column grow"
          style="min-height: 0; min-width: 0;"
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
                :is="cameraAnnotatorComponent(camera)"
                v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
                ref="subPlaybackComponent"
                class="fill-height"
                :class="{ 'selected-camera': selectedCamera === camera && camera !== 'singleCam' }"
                v-bind="{
                  imageData: imageData[camera],
                  videoUrl: videoUrl[camera],
                  updateTime: selectedCameraUpdateTime(camera),
                  frameRate,
                  originalFps,
                  camera,
                  imageEnhancementOutputs: cameraEnhOutputs(camera),
                  isDefaultImage: isCameraDefault(camera),
                  getTiles,
                  getTileURL,
                  percentileStretch: cameraPercentileStretch(camera),
                  filterId: `imageEnhancements-${camera}`,
                }"
                @large-image-warning="$emit('large-image-warning', true)"
              >
                <LayerManager :camera="camera" />
              </component>
            </div>
          </div>
          <BottomPanel
            :sidebar-mode="sidebarMode"
            :is-stereo-dataset="subType === 'stereo'"
            :controls-ref="controlsRef"
            :controls-collapsed.sync="controlsCollapsed"
            :line-chart-data="lineChartData"
            :event-chart-data="eventChartData"
            :group-chart-data="groupChartData"
            :dataset-type="datasetType"
            :is-default-image="isCameraDefault(selectedCamera)"
            :client-settings="clientSettings"
            :track-filters="trackFilters"
            :attributes="attributes"
            :frame-rate="frameRate"
            :readonly-state="readonlyState"
            :disable-annotation-filters="disableAnnotationFilters"
            :prompt-visible="visible"
            :confidence-filters="confidenceFilters"
            :aggregate-seek="seekToFrame"
            :track-style-manager="trackStyleManager"
            :bottom-right-panel-view="bottomRightPanelView"
            :toggle-bottom-right-panel="toggleBottomRightPanel"
            :selected-track-for-details="selectedTrackForDetails ?? undefined"
            :show-confidence-first="showConfidenceFirst"
            :show-track-attributes-first="showTrackAttributesFirst"
            :edit-individual="editIndividual ?? undefined"
            :set-edit-individual="setEditIndividual"
            :reset-edit-individual="resetEditIndividual"
            :add-attribute="addAttribute"
            :edit-attribute="editAttribute"
            :save-threshold="saveThreshold"
          />
        </div>
        <div
          v-else
          class="d-flex justify-center align-center fill-height grow"
          style="min-width: 0;"
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
        :error="editingError ?? undefined"
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

.camera-select {
  width: 100px;
  max-width: 100px;
  flex: 0 0 auto;
  font-size: 0.9em;
}

.camera-select .v-select__selections {
  flex-wrap: nowrap;
  min-width: 0;
}

.camera-select .v-select__selection--comma {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.camera-select fieldset {
  height: 33px;
  margin-top: 4px;
}
</style>
