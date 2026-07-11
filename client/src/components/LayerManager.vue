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
  useAlignedView,
  useSelectedCamera,
  useAttributes,
  useComparisonSets,
  useLassoModeContext,
  useSegmentationPoints,
} from '../provides';
import SegmentationPointsLayer from '../layers/AnnotationLayers/SegmentationPointsLayer';
import useLayerManagerAlignedView from './layerManager/useLayerManagerAlignedView';
import useLayerRefresh from './layerManager/useLayerRefresh';
import useSegmentationPointsLayer from './layerManager/useSegmentationPointsLayer';
import useAnnotationClickHandling from './layerManager/useAnnotationClickHandling';
import { cameraAwaitingGeometry, isCreatingNewDetection } from './layerManager/multicamCreation';

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
    let alignedView: ReturnType<typeof useAlignedView> | undefined;
    try {
      alignedView = useAlignedView();
    } catch {
      // aligned view store may not be provided in tests or minimal embeds.
    }
    const selectedCamera = useSelectedCamera();
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
    const hasFrameRef = annotator.hasFrame;

    const {
      alignedDisplayTransform,
      mapDisplayPoint,
      featureToDisplay,
      setupDisplayTransformWatches,
      ...alignedViewHelpers
    } = useLayerManagerAlignedView({
      camera: props.camera,
      annotator,
      aggregateController,
      alignedView,
      editingModeRef,
    });

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

    useSegmentationPointsLayer({
      camera: props.camera,
      segmentationPointsRef,
      frameNumberRef,
      selectedCamera,
      segmentationPointsLayer,
      mapDisplayPoint,
    });

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
      // Drawing and editing work on every camera while the aligned view is
      // on: the edit layer operates in display (warped) space -- it is fed
      // display-space copies of the geometry (featureToDisplay below) and its
      // draws/edits are mapped back to native through alignedDisplayInverse
      // in the update:geojson handler before committing to track storage.
      const currentFrameIds: AnnotationId[] | undefined = trackStore?.intervalTree
        .search([frame, frame])
        .map((str) => parseInt(str, 10));
      const inlcudesTooltip = visibleModes.includes('tooltip');
      rectAnnotationLayer.setHoverAnnotations(inlcudesTooltip);
      polyAnnotationLayer.setHoverAnnotations(inlcudesTooltip);
      if (!inlcudesTooltip) {
        hoverOvered.value = [];
      }
      const frameData = [] as FrameDataTrack[];
      const editingTracks = [] as FrameDataTrack[];
      if (currentFrameIds === undefined) {
        return;
      }
      currentFrameIds.forEach(
        (trackId: AnnotationId) => {
          const track = trackStore?.getPossible(trackId);
          if (track === undefined) {
            // Track may be located in another Camera
            // TODO: Find a better way to represent tracks outside of cameras
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
            const trackFrame = {
              selected: ((selectedTrackId === track.trackId)
                || (multiSelectList.includes(track.trackId))),
              editing: editingTrack,
              track,
              groups,
              features,
              styleType: colorBy === 'group' ? groupStyleType : trackStyleType,
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
                  // Under the aligned view the display is warped, so center
                  // on the displayed (warped) location, not the native one.
                  const coords = {
                    ...mapDisplayPoint(
                      (trackFrame.features.bounds[0] + trackFrame.features.bounds[2]) / 2.0,
                      (trackFrame.features.bounds[1] + trackFrame.features.bounds[3]) / 2.0,
                    ),
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

                    // Map the zoom-target corners into display space too
                    // (identity when the aligned view is off).
                    const ulMapped = mapDisplayPoint(centerX - halfWidth, centerY - halfHeight);
                    const lrMapped = mapDisplayPoint(centerX + halfWidth, centerY + halfHeight);
                    const left = Math.min(ulMapped.x, lrMapped.x);
                    const right = Math.max(ulMapped.x, lrMapped.x);
                    const top = Math.min(ulMapped.y, lrMapped.y);
                    const bottom = Math.max(ulMapped.y, lrMapped.y);

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
        //We modify rects opacity/thickness if polygons are visible or not
        rectAnnotationLayer.setDrawingOther(visibleModes.includes('Polygon'));
        rectAnnotationLayer.changeData(frameData, comparison.value);
        if (comparison.value.length) {
          overlapLayer.changeData(frameData);
        }
      } else {
        rectAnnotationLayer.disable();
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
      // Track tails read multi-frame geometry straight from the trackStore
      // (not FrameDataTrack) and are not routed through the display
      // transform, so they are hidden for warped cameras while the aligned
      // view is on rather than rendered in the wrong (native) space.
      if (visibleModes.includes('TrackTail') && !alignedDisplayTransform.value) {
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
            // The edit layer works in display space: hand it display-space
            // copies of the feature so its handles land on warped imagery
            // (identity when this camera renders unwarped).
            editAnnotationLayer.changeData(editingTracks.map((trackFrame) => ({
              ...trackFrame,
              features: featureToDisplay(trackFrame.features),
            })));
          }
        } else if (editingTrack && props.camera !== selectedCamera.value
          && (isCreatingNewDetection(
            cameraStore,
            props.camera,
            frame,
            selectedTrackId,
          )
            || cameraAwaitingGeometry(
              cameraStore,
              props.camera,
              frame,
              selectedTrackId,
              editingTrack,
              selectedKey,
            ))) {
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

    const { refreshLayers } = useLayerRefresh({
      hasFrameRef,
      frameNumberRef,
      editingModeRef,
      selectedTrackIdRef,
      multiSelectListRef: multiSeletListRef,
      enabledTracksRef,
      visibleModesRef,
      selectedKeyRef,
      colorBy: toRef(props, 'colorBy'),
      layers: {
        rectAnnotationLayer,
        overlapLayer,
        polyAnnotationLayer,
        lineLayer,
        pointLayer,
        tailLayer,
        textLayer,
        attributeLayer,
        attributeBoxLayer,
        editAnnotationLayer,
        segmentationPointsLayer,
        uiLayer,
      },
      hoverOvered,
      updateLayers,
    });

    /** Layers whose stored-geometry rendering follows the aligned-view warp. */
    const displayTransformedLayers = [
      rectAnnotationLayer,
      overlapLayer,
      polyAnnotationLayer,
      lineLayer,
      pointLayer,
      textLayer,
      attributeBoxLayer,
      attributeLayer,
    ];

    setupDisplayTransformWatches(displayTransformedLayers, refreshLayers, frameNumberRef);

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
      ],
      () => {
        refreshLayers();
      },
    );

    /** Deep watch */
    watch(
      annotatorPrefs,
      () => {
        refreshLayers();
      },
      { deep: true },
    );

    watch(attributes, () => {
      updateAttributes();
      refreshLayers();
    });

    /** Watch for resize events to redraw layers after view mode changes */
    watch(
      () => aggregateController.value.resizeTrigger.value,
      () => {
        window.requestAnimationFrame(() => {
          if (!annotator.geoViewerRef?.value) {
            return;
          }
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
      },
    );

    const { wireHandlers } = useAnnotationClickHandling({
      camera: props.camera,
      handler,
      selectedCamera,
      selectedTrackIdRef,
      selectedKeyRef,
      frameNumberRef,
      flickNumberRef,
      editingModeRef,
      cameraStore,
      trackStore,
      alignedView: alignedViewHelpers,
      editAnnotationLayer,
      rectAnnotationLayer,
      polyAnnotationLayer,
      lineLayer,
      refreshLayers,
    });
    wireHandlers();

    const annotationHoverTooltip = (
      found: {
          styleType: [string, number];
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
            type: item.styleType[0],
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
