<script lang="ts">
import {
  defineComponent, watch, PropType, Ref, ref, computed, toRef,
} from 'vue';

import { clientSettings } from 'dive-common/store/settings';
import { TrackWithContext } from '../BaseFilterControls';
import { injectAggregateController } from './annotators/useMediaController';
import RectangleLayer from '../layers/AnnotationLayers/RectangleLayer';
import PolygonLayer from '../layers/AnnotationLayers/PolygonLayer';
import PointLayer from '../layers/AnnotationLayers/PointLayer';
import LineLayer from '../layers/AnnotationLayers/LineLayer';
import TailLayer from '../layers/AnnotationLayers/TailLayer';
import OverlapLayer from '../layers/AnnotationLayers/OverlapLayer';

import EditAnnotationLayer, { EditAnnotationTypes } from '../layers/EditAnnotationLayer';
import LassoSelectionLayer from '../layers/LassoSelectionLayer';
import { FrameDataTrack } from '../layers/LayerTypes';
import TextLayer, { FormatTextRow } from '../layers/AnnotationLayers/TextLayer';
import AttributeLayer from '../layers/AnnotationLayers/AttributeLayer';
import AttributeBoxLayer from '../layers/AnnotationLayers/AttributeBoxLayer';
import type { AnnotationId } from '../BaseAnnotation';
import {
  geojsonToBound, isRotationValue, ROTATION_ATTRIBUTE_NAME, featureHasSegmentationPolygon,
} from '../utils';
import { getSuppressedTrackIds, hasSuppressionAttribute } from '../use/suppression';
import { VisibleAnnotationTypes } from '../layers';
import UILayer from '../layers/UILayers/UILayer';
import ToolTipWidget from '../layers/UILayers/ToolTipWidget.vue';
import { ToolTipWidgetData } from '../layers/UILayers/UILayerTypes';
import {
  useHandler,
  useSelectedTrackId,
  useTrackFilters,
  useTrackStyleManager,
  useEditingMode,
  useVisibleModes,
  useSelectedKey,
  useMultiSelectList,
  useAnnotatorPreferences,
  useGroupStyleManager,
  useCameraStore,
  useSelectedCamera,
  useAttributes,
  useComparisonSets,
  useLassoModeContext,
  useSegmentationPoints,
  usePendingSaveCount,
} from '../provides';
import SegmentationPointsLayer from '../layers/AnnotationLayers/SegmentationPointsLayer';

/** LayerManager is a component intended to be used as a child of an Annotator.
 *  It provides logic for switching which layers are visible, but more importantly
 *  it maps Track objects into their respective layer representations.
 *  LayerManager emits high-level events when track features get selected or updated.
 */
export default defineComponent({
  props: {
    formatTextRow: {
      type: Function as PropType<FormatTextRow | undefined>,
      default: undefined,
    },
    colorBy: {
      type: String as PropType<'group' | 'track'>,
      default: 'track',
    },
    camera: {
      type: String,
      default: 'singleCam',
    },

  },
  setup(props) {
    const handler = useHandler();
    let setLassoDrawing: ((drawing: boolean) => void) | undefined;
    try {
      ({ setLassoDrawing } = useLassoModeContext());
    } catch {
      // Viewer may not provide lasso context in tests or minimal embeds.
    }
    const cameraStore = useCameraStore();
    const selectedCamera = useSelectedCamera();
    const pendingSaveCount = usePendingSaveCount();
    const comparison = useComparisonSets();
    const trackStore = cameraStore.camMap.value.get(props.camera)?.trackStore;
    const groupStore = cameraStore.camMap.value.get(props.camera)?.groupStore;
    const attributes = useAttributes();
    if (!trackStore || !groupStore) {
      throw Error(`TrackStore: ${trackStore} or GroupStore: ${groupStore} are undefined for camera ${props.camera}`);
    }
    const enabledTracksRef = useTrackFilters().enabledAnnotations;
    const selectedTrackIdRef = useSelectedTrackId();
    const multiSeletListRef = useMultiSelectList();
    const editingModeRef = useEditingMode();
    const visibleModesRef = useVisibleModes();
    const selectedKeyRef = useSelectedKey();
    const trackStyleManager = useTrackStyleManager();
    const groupStyleManager = useGroupStyleManager();
    const annotatorPrefs = useAnnotatorPreferences();
    const typeStylingRef = computed(() => {
      if (props.colorBy === 'group') {
        return groupStyleManager.typeStyling.value;
      }
      return trackStyleManager.typeStyling.value;
    });

    const aggregateController = injectAggregateController();
    const annotator = aggregateController.value.getController(props.camera);
    const frameNumberRef = annotator.frame;
    const flickNumberRef = annotator.flick;

    const rectAnnotationLayer = new RectangleLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    });
    const overlapLayer = new OverlapLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    });

    const polyAnnotationLayer = new PolygonLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    });

    const lineLayer = new LineLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    });
    const pointLayer = new PointLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    });
    const tailLayer = new TailLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    }, trackStore);

    const showUserCreatedIconRef = computed(() => annotatorPrefs.value.showUserCreatedIcon ?? true);
    const textLayer = new TextLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
      formatter: props.formatTextRow,
      showUserCreatedIcon: showUserCreatedIconRef,
    });

    const attributeBoxLayer = new AttributeBoxLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    });

    const attributeLayer = new AttributeLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
    });

    const editAnnotationLayer = new EditAnnotationLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
      type: 'rectangle',
    });

    const lassoSelectionLayer = new LassoSelectionLayer(
      annotator,
      () => [rectAnnotationLayer.featureLayer, polyAnnotationLayer.featureLayer],
      () => editAnnotationLayer.getMode() === 'creation',
      setLassoDrawing,
    );

    // Segmentation points layer for displaying prompt points during point-click segmentation
    const segmentationPointsRef = useSegmentationPoints();
    const segmentationPointsLayer = new SegmentationPointsLayer(annotator);

    // Watch for segmentation points updates - only show points for the current
    // frame, and only on the selected camera. The prompt points belong to the
    // image being segmented; without the camera check every camera rendered
    // them at the same pixel coordinates, which looked like an (unwarped)
    // point being created on the other camera.
    watch([segmentationPointsRef, frameNumberRef, selectedCamera], ([newPoints, currentFrame, currentCamera]) => {
      if (newPoints.points.length > 0 && newPoints.frameNum === currentFrame
        && props.camera === currentCamera) {
        segmentationPointsLayer.updatePoints(newPoints.points, newPoints.labels);
      } else {
        segmentationPointsLayer.clear();
      }
    }, { deep: true });

    const updateAttributes = () => {
      const newList = attributes.value.filter((item) => item.render).sort((a, b) => {
        if (a.render && b.render) {
          return (a.render.order - b.render.order);
        }
        return 0;
      });
      const user = ''; // TODO: Make a global setting for Web/Desktop
      attributeLayer.updateRenderAttributes(newList, user);
      attributeBoxLayer.updateRenderAttributes(newList);
    };
    updateAttributes();
    const uiLayer = new UILayer(annotator);
    const hoverOvered: Ref<ToolTipWidgetData[]> = ref([]);
    const toolTipWidgetProps = {
      color: typeStylingRef.value.color,
      dataList: hoverOvered,
      selected: selectedTrackIdRef,
      stateStyling: trackStyleManager.stateStyles,
    };
    uiLayer.addDOMWidget('customToolTip', ToolTipWidget, toolTipWidgetProps, { x: 10, y: 10 });

    // True when the selected track is a brand-new detection with no geometry yet
    // on this frame (the user is mid-creation). Used to mirror the creation cursor
    // onto non-selected cameras so a new detection can be drawn on any camera.
    function isCreatingNewDetection(frame: number, trackId: AnnotationId | null): boolean {
      if (trackId === null) return false;
      const t = cameraStore.getPossibleTrack(trackId, selectedCamera.value);
      if (!t) return false;
      return t.getFeature(frame)[0] == null;
    }

    // True when, while editing, the selected track has no geometry on THIS
    // camera at this frame (the track may not exist on this camera at all).
    // For Point mode (point-click segmentation) "no geometry" means no
    // segmentation polygon here yet, so a detection that only has a box still
    // accepts a point click.
    // Complements isCreatingNewDetection: after the detection is drawn on one
    // camera, the creation cursor stays live on the cameras still missing it,
    // so it can be drawn on each in turn (same track id) without selecting the
    // camera first.
    function cameraAwaitingGeometry(
      frame: number,
      trackId: AnnotationId | null,
      editingTrack: false | EditAnnotationTypes,
      selectedKey: string,
    ): boolean {
      if (trackId === null || !editingTrack) return false;
      if (!cameraStore.getAnyPossibleTrack(trackId)) return false;
      const t = cameraStore.getPossibleTrack(trackId, props.camera);
      if (!t) return true;
      const [feature] = t.getFeature(frame);
      if (feature == null) return true;
      if (editingTrack === 'Point') {
        return !featureHasSegmentationPolygon(feature, selectedKey);
      }
      return false;
    }

    function updateLayers(
      frame: number,
      editingTrack: false | EditAnnotationTypes,
      selectedTrackId: AnnotationId | null,
      multiSelectList: readonly AnnotationId[],
      enabledTracks: readonly TrackWithContext[],
      visibleModes: readonly VisibleAnnotationTypes[],
      selectedKey: string,
      colorBy: string,
    ) {
      const currentFrameIds: AnnotationId[] | undefined = trackStore?.intervalTree
        .search([frame, frame])
        .map((str) => parseInt(str, 10));
      const inlcudesTooltip = visibleModes.includes('tooltip');
      // Hidden boxes (kept only as invisible click targets) should not
      // produce hover tooltips
      rectAnnotationLayer.setHoverAnnotations(inlcudesTooltip && visibleModes.includes('rectangle'));
      polyAnnotationLayer.setHoverAnnotations(inlcudesTooltip);
      if (!inlcudesTooltip) {
        hoverOvered.value = [];
      }
      const frameData = [] as FrameDataTrack[];
      const editingTracks = [] as FrameDataTrack[];
      if (currentFrameIds === undefined) {
        return;
      }
      // Detections lying under a suppression region on this frame (by at
      // least the configured overlap) are hidden from every layer at once
      // (and excluded from counts elsewhere).
      const { suppressionType, suppressionThreshold } = clientSettings.typeSettings;
      const suppressedIds = trackStore
        ? getSuppressedTrackIds(
          trackStore,
          frame,
          suppressionType,
          suppressionThreshold,
          { revision: pendingSaveCount.value },
        )
        : new Set<AnnotationId>();
      currentFrameIds.forEach(
        (trackId: AnnotationId) => {
          const track = trackStore?.getPossible(trackId);
          if (track === undefined) {
            // Track may be located in another Camera
            // TODO: Find a better way to represent tracks outside of cameras
            return;
          }
          if (suppressedIds.has(trackId)) {
            return;
          }

          const enabledIndex = enabledTracks.findIndex(
            (trackWithContext) => trackWithContext.annotation.id === trackId,
          );
          if (enabledIndex !== -1) {
            const [features] = track.getFeature(frame);
            const groups = cameraStore.lookupGroups(track.id);
            const trackStyleType = track.getType(
              enabledTracks[enabledIndex].context.confidencePairIndex,
            );
            const groupStyleType = groups?.[0]?.getType() ?? cameraStore.defaultGroup;
            // A detection flagged with the suppression attribute (it is NOT
            // under a region - those are hidden above) stays visible but
            // displays as suppressed: layers label it 'Type - SuppressionType'
            // and blend its styling 2/3 toward the suppression type. It keeps
            // its real type everywhere else.
            const styleType: [string, number] = colorBy === 'group' ? groupStyleType : trackStyleType;
            const suppressed = (suppressionType
              && hasSuppressionAttribute(track, frame, suppressionType))
              ? suppressionType : undefined;
            const trackFrame = {
              selected: ((selectedTrackId === track.trackId)
                || (multiSelectList.includes(track.trackId))),
              editing: editingTrack,
              track,
              groups,
              features,
              styleType,
              suppressed,
              set: track.set,
            };
            frameData.push(trackFrame);
            if (trackFrame.selected) {
              // While editing, show edit handles on EVERY camera where the
              // selected track has geometry at this frame -- not just the
              // selected camera -- so a stereo detection can be adjusted on
              // either camera without selecting it first. The mousedown that
              // grabs a handle switches the selected camera first
              // (Viewer.changeCamera keeps edit mode when the track exists on
              // the target camera), and the update:geojson routing below is
              // the fallback for edits that land before the switch.
              if (editingTrack) {
                editingTracks.push(trackFrame);
              }
              if (clientSettings.annotatorPreferences.lockedCamera.enabled) {
                if (trackFrame.features?.bounds) {
                  const coords = {
                    x: (trackFrame.features.bounds[0] + trackFrame.features.bounds[2]) / 2.0,
                    y: (trackFrame.features.bounds[1] + trackFrame.features.bounds[3]) / 2.0,
                    z: 0,
                  };
                  const [x0, y0, x1, y1] = trackFrame.features.bounds;

                  const centerX = (x0 + x1) / 2.0;
                  const centerY = (y0 + y1) / 2.0;

                  const width = Math.abs(x1 - x0);
                  const height = Math.abs(y1 - y0);

                  // eslint-disable-next-line no-undef-init
                  let zoom: number | undefined = undefined;
                  if (clientSettings.annotatorPreferences.lockedCamera.multiBounds) {
                    const multiplyBoundsVal = clientSettings.annotatorPreferences.lockedCamera.multiBounds ?? 1;

                    const halfWidth = (width * multiplyBoundsVal) / 2.0;
                    const halfHeight = (height * multiplyBoundsVal) / 2.0;

                    const left = centerX - halfWidth;
                    const right = centerX + halfWidth;
                    const top = centerY - halfHeight;
                    const bottom = centerY + halfHeight;

                    const zoomAndCenter = annotator.geoViewerRef.value.zoomAndCenterFromBounds({
                      left, top, right, bottom,
                    });
                    zoom = Math.round(zoomAndCenter.zoom);
                  }
                  if (clientSettings.annotatorPreferences.lockedCamera.transition) {
                    annotator.transition({ x: coords.x, y: coords.y }, clientSettings.annotatorPreferences.lockedCamera.transition, zoom);
                  } else {
                    annotator.transition({ x: coords.x, y: coords.y }, 0, zoom);
                  }
                }
              }
            }
          }
        },
      );

      if (visibleModes.includes('rectangle')) {
        rectAnnotationLayer.setClickTargetsOnly(false);
        //We modify rects opacity/thickness if polygons are visible or not
        rectAnnotationLayer.setDrawingOther(visibleModes.includes('Polygon'));
        rectAnnotationLayer.changeData(frameData, comparison.value);
        if (comparison.value.length) {
          overlapLayer.changeData(frameData);
        }
      } else {
        // Keep the hidden boxes around as invisible right-click targets so a
        // detection can still be right-clicked into edit mode no matter which
        // of its displays are turned on
        rectAnnotationLayer.setClickTargetsOnly(true);
        // drawingOther still tracks polygon visibility so click targeting
        // can defer to drawn polygons.
        rectAnnotationLayer.setDrawingOther(visibleModes.includes('Polygon'));
        rectAnnotationLayer.changeData(frameData, comparison.value);
      }
      if (visibleModes.includes('Polygon')) {
        polyAnnotationLayer.setDrawingOther(visibleModes.includes('rectangle'));
        polyAnnotationLayer.changeData(frameData);
      } else {
        polyAnnotationLayer.disable();
      }
      if (visibleModes.includes('LineString')) {
        lineLayer.changeData(frameData);
      } else {
        lineLayer.disable();
      }
      if (visibleModes.includes('TrackTail')) {
        tailLayer.updateSettings(
          frame,
          annotatorPrefs.value.trackTails.before,
          annotatorPrefs.value.trackTails.after,
        );
        tailLayer.changeData(frameData);
      } else {
        tailLayer.disable();
      }
      if (visibleModes.includes('LineString')) {
        pointLayer.changeData(frameData);
      } else {
        pointLayer.disable();
      }
      if (visibleModes.includes('text')) {
        textLayer.changeData(frameData);
        attributeBoxLayer.changeData(frameData);
        attributeLayer.changeData(frameData);
      } else {
        textLayer.disable();
        attributeLayer.disable();
        attributeBoxLayer.disable();
      }

      if (selectedTrackId !== null) {
        if ((editingTrack) && !currentFrameIds.includes(selectedTrackId)
        && props.camera === selectedCamera.value) {
          const editTrack = trackStore?.getPossible(selectedTrackId);
          if (editTrack === undefined) {
            throw new Error(`trackMap missing trackid ${selectedTrackId}`);
          }
          const [real, lower, upper] = editTrack.getFeature(frame);
          const features = real || lower || upper;
          const trackFrame = {
            selected: true,
            editing: true,
            track: editTrack,
            groups: cameraStore.lookupGroups(editTrack.id),
            features: (features && features.interpolate) ? features : null,
            styleType: cameraStore.defaultGroup, // Won't be used
          };
          editingTracks.push(trackFrame);
        }
        if (editingTracks.length) {
          if (editingTrack) {
            editAnnotationLayer.setType(editingTrack);
            editAnnotationLayer.setKey(selectedKey);
            editAnnotationLayer.changeData(editingTracks);
          }
        } else if (editingTrack && props.camera !== selectedCamera.value
          && (isCreatingNewDetection(frame, selectedTrackId)
            || cameraAwaitingGeometry(frame, selectedTrackId, editingTrack, selectedKey))) {
          // Seamless multicam creation: keep the creation cursor live on every
          // camera (not just the selected one) so a brand-new detection can be
          // drawn on whichever camera the user starts on -- and, once drawn on
          // one camera, immediately drawn on the others while still in edit
          // mode. The draw is routed to the drawn-on camera in the
          // update:geojson handler below.
          editAnnotationLayer.setType(editingTrack);
          editAnnotationLayer.setKey(selectedKey);
          editAnnotationLayer.changeData([]);
        } else {
          editAnnotationLayer.disable();
        }
      } else {
        editAnnotationLayer.disable();
      }
    }

    /**
     * TODO: for some reason, GeoJS requires us to initialize
     * by calling the render function twice.  This is a bug.
     * https://github.com/Kitware/dive/issues/365
     */
    [1, 2].forEach(() => {
      updateLayers(
        frameNumberRef.value,
        editingModeRef.value,
        selectedTrackIdRef.value,
        multiSeletListRef.value,
        enabledTracksRef.value,
        visibleModesRef.value,
        selectedKeyRef.value,
        props.colorBy,
      );
    });

    /** Shallow watch */
    watch(
      [
        frameNumberRef,
        editingModeRef,
        enabledTracksRef,
        selectedTrackIdRef,
        multiSeletListRef,
        visibleModesRef,
        typeStylingRef,
        toRef(props, 'colorBy'),
        selectedCamera,
        selectedKeyRef,
        // re-render when the suppression-region type or threshold is changed
        () => clientSettings.typeSettings.suppressionType,
        () => clientSettings.typeSettings.suppressionThreshold,
      ],
      () => {
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          multiSeletListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
          props.colorBy,
        );
      },
    );

    /** Deep watch */
    watch(
      annotatorPrefs,
      () => {
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          multiSeletListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
          props.colorBy,
        );
      },
      { deep: true },
    );

    watch(attributes, () => {
      updateAttributes();
      updateLayers(
        frameNumberRef.value,
        editingModeRef.value,
        selectedTrackIdRef.value,
        multiSeletListRef.value,
        enabledTracksRef.value,
        visibleModesRef.value,
        selectedKeyRef.value,
        props.colorBy,
      );
    });

    /** Watch for resize events to redraw layers after view mode changes */
    watch(
      () => aggregateController.value.resizeTrigger.value,
      () => {
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          multiSeletListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
          props.colorBy,
        );
      },
    );

    // Set briefly when a draw finalizes so the same click — e.g. the 2nd line
    // vertex / rectangle corner landing on an overlapping existing detection —
    // doesn't also select that detection. Cleared on the next macrotask, so only
    // the click that completed the draw is suppressed.
    let justFinalizedCreation = false;

    // Guards against a single physical click being handled more than once when
    // it lands on overlapping features on different layers. A skinny box hugging
    // its head/tail line is the common case: the click hits both the rectangle
    // polygon and the line, so both layers emit annotation-(right-)clicked in
    // the same tick. Because trackEdit toggles edit mode, the second emit would
    // immediately undo the first (right-click enters edit, then leaves it,
    // ending up merely selected). Cleared on the next macrotask, so distinct
    // user clicks (separate ticks) are unaffected.
    let clickHandledThisTick = false;

    const Clicked = (trackId: number, editing: boolean, modifiers?: {ctrl: boolean}) => {
      // The click that just finalized a new detection should not also select an
      // existing detection underneath the final vertex.
      if (justFinalizedCreation) {
        return;
      }
      if (clickHandledThisTick) {
        return;
      }
      clickHandledThisTick = true;
      window.setTimeout(() => { clickHandledThisTick = false; }, 0);
      // Clicking a detection in a camera that isn't selected yet: switch to that
      // camera AND act on the detection in the same click — left-click selects,
      // right-click edits — instead of requiring a separate click to switch first.
      if (selectedCamera.value !== props.camera) {
        // Mid new-detection creation, a left-click on this camera is the start of
        // a draw (handled by the creation layer + update routing) — don't let it
        // select an existing detection under the first corner. Right-click still
        // switches to editing the clicked detection.
        if (editAnnotationLayer.getMode() === 'creation' && !editing) {
          return;
        }
        if (trackId !== null) {
          handler.selectCamera(props.camera, false);
          // selectCamera switches synchronously in the normal path; bail if a mode
          // (e.g. linking) blocked the switch so we don't act on the wrong camera.
          if (selectedCamera.value === props.camera) {
            handler.trackSelect(trackId, false, modifiers);
            if (editing) {
              handler.trackEdit(trackId);
            }
          }
        }
        return;
      }
      //So we only want to pass the click whjen not in creation mode or editing mode for features
      if (editAnnotationLayer.getMode() !== 'creation') {
        editAnnotationLayer.disable();
        // When entering editing mode (right-click), use trackEdit so the
        // geometry type is auto-detected (e.g. LineString vs rectangle).
        if (editing && trackId !== null) {
          handler.trackEdit(trackId);
        } else {
          handler.trackSelect(trackId, editing, modifiers);
        }
      } else if (editing && trackId !== null) {
        // Right-click on another detection while in creation mode:
        // cancel creation and switch to editing the clicked detection
        editAnnotationLayer.disable();
        handler.trackEdit(trackId);
      }
    };

    //Sync of internal geoJS state with the application
    editAnnotationLayer.bus.$on('editing-annotation-sync', (editing: boolean, deselect?: boolean) => {
      if (deselect) {
        handler.trackSelect(null, false);
      } else {
        handler.trackSelect(selectedTrackIdRef.value, editing);
      }
    });
    // Handle right-click to confirm/lock annotation in Point mode (segmentation)
    editAnnotationLayer.bus.$on('confirm-annotation', () => {
      handler.confirmRecipe();
    });
    // Register callback so pressing 'n' (new detection) finalizes in-progress shapes
    handler.registerFinalizeCreation(() => {
      editAnnotationLayer.finalizeInProgress();
    });
    rectAnnotationLayer.bus.$on('annotation-clicked', Clicked);
    rectAnnotationLayer.bus.$on('annotation-right-clicked', Clicked);
    rectAnnotationLayer.bus.$on('annotation-ctrl-clicked', Clicked);
    polyAnnotationLayer.bus.$on('annotation-clicked', Clicked);
    polyAnnotationLayer.bus.$on('annotation-right-clicked', Clicked);
    // Handle right-click polygon selection for multi-polygon support
    polyAnnotationLayer.bus.$on('polygon-right-clicked', (_trackId: number, polygonKey: string) => {
      // If in creation mode, cancel it first so we can select the polygon
      if (editAnnotationLayer.getMode() === 'creation') {
        handler.cancelCreation();
      }
      // Set the polygon key for the right-clicked polygon
      handler.selectFeatureHandle(-1, polygonKey);
      // Force layer update to load the selected polygon
      // This is especially important when already editing the same track
      // since annotation-right-clicked won't be emitted in that case
      window.setTimeout(() => {
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          multiSeletListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
          props.colorBy,
        );
      }, 0);
    });
    polyAnnotationLayer.bus.$on('annotation-ctrl-clicked', Clicked);
    lineLayer.bus.$on('annotation-clicked', Clicked);
    lineLayer.bus.$on('annotation-right-clicked', Clicked);
    // Handle polygon selection for multi-polygon support
    polyAnnotationLayer.bus.$on('polygon-clicked', (_trackId: number, polygonKey: string) => {
      // If in creation mode, don't interrupt - let the edit layer handle clicks for placing points
      // This is important for hole drawing where left-clicks place hole vertices
      if (editAnnotationLayer.getMode() === 'creation') {
        return;
      }
      handler.selectFeatureHandle(-1, polygonKey);
      // Force layer update to load the newly selected polygon
      // Use nextTick to ensure the selectedKey ref has been updated
      window.setTimeout(() => {
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          multiSeletListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
          props.colorBy,
        );
      }, 0);
    });
    // Handle right-click outside polygons to finalize/cancel creation
    polyAnnotationLayer.bus.$on('polygon-right-clicked-outside', () => {
      if (editAnnotationLayer.getMode() === 'creation') {
        // Cancel creation and go back to editing the default polygon
        handler.cancelCreation();
        handler.selectFeatureHandle(-1, '');
        window.setTimeout(() => {
          updateLayers(
            frameNumberRef.value,
            editingModeRef.value,
            selectedTrackIdRef.value,
            multiSeletListRef.value,
            enabledTracksRef.value,
            visibleModesRef.value,
            selectedKeyRef.value,
            props.colorBy,
          );
        }, 0);
      }
    });
    editAnnotationLayer.bus.$on('update:geojson', (
      mode: 'in-progress' | 'editing',
      geometryCompleteEvent: boolean,
      data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>,
      type: string,
      key = '',
      cb: () => void = () => (undefined),
    ) => {
      // Seamless multicam creation: a draw that lands on a camera that isn't the
      // selected one must commit on THIS camera.
      if (props.camera !== selectedCamera.value) {
        if (isCreatingNewDetection(frameNumberRef.value, selectedTrackIdRef.value)) {
          // Brand-new detection: switch to this camera and start a fresh
          // detection here (the empty origin track is auto-cleaned on camera
          // switch) so the geometry is applied to the camera the user drew on.
          handler.selectCamera(props.camera, false);
          if (selectedCamera.value === props.camera) {
            handler.trackAdd();
          }
        } else if (cameraAwaitingGeometry(frameNumberRef.value, selectedTrackIdRef.value, editingModeRef.value, selectedKeyRef.value)) {
          // Extending the selected detection to this camera (it already has
          // geometry on another camera): create the same-id track on this
          // camera BEFORE switching, so selectCamera keeps edit mode without
          // toggling trackEdit (which would finalize/interrupt the in-progress
          // draw). The update below then commits here under the same track id.
          // For Point mode (point-click segmentation), selectCamera also
          // finalizes the source camera's pending mask and clears the recipe's
          // accumulated prompt points -- those points belong to the source
          // camera's image and must not leak into this camera's prediction.
          const trackId = selectedTrackIdRef.value as number;
          if (!cameraStore.getPossibleTrack(trackId, props.camera)) {
            const anyTrack = cameraStore.getAnyPossibleTrack(trackId);
            const trackType = anyTrack?.confidencePairs?.[0]?.[0] || 'unknown';
            trackStore.add(frameNumberRef.value, trackType, undefined, trackId);
          }
          handler.selectCamera(props.camera, false);
          if (editingModeRef.value === 'Point' && selectedCamera.value !== props.camera) {
            // The switch was blocked (e.g. linking mode): a segmentation point
            // clicked on this camera must never be added to the selected
            // camera's prompt points, so drop the click.
            return;
          }
        } else if (editingModeRef.value && selectedTrackIdRef.value !== null
          && cameraStore.getPossibleTrack(selectedTrackIdRef.value, props.camera)) {
          // Editing the selected track's existing geometry on this camera
          // (edit handles are live on every camera showing the track): switch
          // so the edit commits to THIS camera's track. Normally the mousedown
          // that grabbed the handle already switched via Viewer.changeCamera;
          // this is the fallback when the update lands first.
          handler.selectCamera(props.camera, false);
          if (selectedCamera.value !== props.camera) {
            // Switch blocked: never commit this camera's edit to the selected
            // camera's track.
            return;
          }
        }
      }
      if (type === 'rectangle') {
        const bounds = geojsonToBound(data as GeoJSON.Feature<GeoJSON.Polygon>);
        // Extract rotation from properties if it exists
        const rotation = data.properties && isRotationValue(data.properties?.[ROTATION_ATTRIBUTE_NAME])
          ? data.properties[ROTATION_ATTRIBUTE_NAME] as number
          : undefined;
        cb();
        handler.updateRectBounds(frameNumberRef.value, flickNumberRef.value, bounds, rotation);
      } else {
        handler.updateGeoJSON(mode, frameNumberRef.value, flickNumberRef.value, data, key, cb);
      }
      // Jump into edit mode if we completed a new shape
      if (geometryCompleteEvent) {
        // Suppress the select that rides along with this same finalizing click.
        justFinalizedCreation = true;
        window.setTimeout(() => { justFinalizedCreation = false; }, 0);
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          multiSeletListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
          props.colorBy,
        );
      }
    });
    editAnnotationLayer.bus.$on(
      'update:selectedIndex',
      (index: number, _type: EditAnnotationTypes, key?: string) => {
        // When deselecting (index -1), don't change the key - it may have been
        // set by polygon-right-clicked/polygon-clicked for multi-polygon selection
        if (index >= 0 && key !== undefined) {
          handler.selectFeatureHandle(index, key);
        } else {
          // Just update the handle index, preserve the current key
          handler.selectFeatureHandle(index, selectedKeyRef.value);
        }
      },
    );
    // Handle clicks outside the edit polygon to allow selecting other polygons
    editAnnotationLayer.bus.$on('click-outside-edit', (geo: { x: number; y: number }) => {
      // Check which polygon was clicked by iterating through formatted data
      const point: [number, number] = [geo.x, geo.y];
      const polygonData = polyAnnotationLayer.formattedData;

      // Find the polygon that contains the click point
      const clickedPolygon = polygonData.find((data) => {
        const coords = data.polygon.coordinates[0] as [number, number][];
        // Ray casting algorithm
        let inside = false;
        for (let i = 0, j = coords.length - 1; i < coords.length; j = i, i += 1) {
          const xi = coords[i][0];
          const yi = coords[i][1];
          const xj = coords[j][0];
          const yj = coords[j][1];
          const intersect = ((yi > point[1]) !== (yj > point[1]))
            && (point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      });

      if (clickedPolygon) {
        const polygonKey = clickedPolygon.polygonKey || '';
        // Select the clicked polygon
        handler.selectFeatureHandle(-1, polygonKey);
        // Force layer update to load the newly selected polygon
        window.setTimeout(() => {
          updateLayers(
            frameNumberRef.value,
            editingModeRef.value,
            selectedTrackIdRef.value,
            multiSeletListRef.value,
            enabledTracksRef.value,
            visibleModesRef.value,
            selectedKeyRef.value,
            props.colorBy,
          );
        }, 0);
      }
    });
    const annotationHoverTooltip = (
      found: {
          styleType: [string, number];
          suppressed?: string;
          trackId: number;
          polygon: { coordinates: Array<Array<[number, number]>>};
        }[],
    ) => {
      const hoveredVals: (ToolTipWidgetData & { maxX: number})[] = [];
      found.forEach((item) => {
        // get Max of X and Min of y for ordering
        if (item.polygon.coordinates.length) {
          let maxX = -Infinity;
          let minY = Infinity;
          item.polygon.coordinates[0].forEach((coord) => {
            if (coord.length === 2) {
              maxX = Math.max(coord[0], maxX);
              minY = Math.min(coord[1], minY);
            }
          });
          hoveredVals.push({
            type: item.suppressed
              ? `${item.styleType[0]} - ${item.suppressed}` : item.styleType[0],
            confidence: item.styleType[1],
            trackId: item.trackId,
            maxX,
          });
        }
      });
      hoverOvered.value = hoveredVals.sort((a, b) => a.maxX - b.maxX);
      uiLayer.setToolTipWidget('customToolTip', (hoverOvered.value.length > 0));
    };
    rectAnnotationLayer.bus.$on('annotation-hover', annotationHoverTooltip);
    polyAnnotationLayer.bus.$on('annotation-hover', annotationHoverTooltip);

    lassoSelectionLayer.bus.$on(
      'lasso-selection',
      (trackIds: AnnotationId[], modifiers: { ctrl: boolean }) => {
        if (selectedCamera.value !== props.camera) {
          return;
        }
        if (editAnnotationLayer.getMode() !== 'creation') {
          handler.lassoSelect(trackIds, modifiers);
        }
      },
    );
  },
});
</script>

<template>
  <div />
</template>
