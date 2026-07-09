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
import AlignedImageLayer from '../layers/AlignedImageLayer';
import { FrameDataTrack } from '../layers/LayerTypes';
import { applyHomography, invert3, Matrix3 } from '../homography';
import { mapBounds, mapRotatedBounds, mapGeoJSONFeatures } from '../alignedView';
import type { Feature } from '../track';
import TextLayer, { FormatTextRow } from '../layers/AnnotationLayers/TextLayer';
import AttributeLayer from '../layers/AnnotationLayers/AttributeLayer';
import AttributeBoxLayer from '../layers/AnnotationLayers/AttributeBoxLayer';
import type { AnnotationId } from '../BaseAnnotation';
import {
  geojsonToBound, isRotationValue, ROTATION_ATTRIBUTE_NAME, featureHasSegmentationPolygon,
  getRotationFromAttributes,
} from '../utils';
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

    /**
     * Resolve another camera's currently displayed frame image (for the ghost
     * overlay and the aligned-view warp). Matches the `quad.image` data used
     * by ImageAnnotator and the `quad.video` data used by VideoAnnotator --
     * geojs' canvas quad renderer supports both as texture sources.
     * LargeImageAnnotator (tiled/geospatial imagery) has no single resolvable
     * image element, so it returns null and the ghost overlay / display warp
     * is simply unavailable for those datasets; picking itself
     * (native-coordinate inverse mapping) is unaffected either way.
     */
    const getCameraImage = (camera: string) => {
      let viewer;
      try {
        // getController throws for an unknown/cleared camera; the ghost and
        // aligned-warp rAF loops call this after a dataset reload has cleared
        // the controllers, so swallow it here rather than let it escape into
        // the animation-frame callback uncaught.
        viewer = aggregateController.value.getController(camera)?.geoViewerRef?.value;
      } catch {
        return null;
      }
      if (!viewer || typeof viewer.layers !== 'function') {
        return null;
      }
      const layerList = viewer.layers();
      for (let i = 0; i < layerList.length; i += 1) {
        const layer = layerList[i];
        if (typeof layer.features === 'function') {
          const features = layer.features();
          for (let j = 0; j < features.length; j += 1) {
            const data = typeof features[j].data === 'function' ? features[j].data() : undefined;
            const datum = Array.isArray(data) ? data[0] : undefined;
            if (datum && datum.image) {
              const image = datum.image as HTMLImageElement;
              return {
                source: image, kind: 'image' as const, width: image.naturalWidth, height: image.naturalHeight,
              };
            }
            if (datum && datum.video) {
              const video = datum.video as HTMLVideoElement;
              return {
                source: video, kind: 'video' as const, width: video.videoWidth, height: video.videoHeight,
              };
            }
          }
        }
      }
      return null;
    };

    /**
     * Aligned view (SEAL-TK features 2 + 3): while active, this camera's
     * display transform (native -> reference space, null when unwarped).
     * Stored geometry stays native (decision D3); the transform is applied
     * at draw time only.
     */
    const alignedDisplayTransform = computed(
      () => (alignedView ? alignedView.cameraTransform(props.camera) : null),
    );
    /**
     * Inverse of the display transform (reference/display space -> this
     * camera's native space). The edit layer operates in geojs map
     * coordinates -- display space -- so draws and edits made while the
     * aligned view warps this camera must be mapped back through this before
     * being committed to (native) track storage.
     */
    const alignedDisplayInverse = computed<Matrix3 | null>(() => {
      const matrix = alignedDisplayTransform.value;
      if (!matrix) {
        return null;
      }
      try {
        return invert3(matrix);
      } catch {
        return null;
      }
    });
    /** Map a native-space location into display space for view centering. */
    const mapDisplayPoint = (x: number, y: number) => {
      const matrix = alignedDisplayTransform.value;
      if (!matrix) {
        return { x, y };
      }
      const [mx, my] = applyHomography(matrix, [x, y]);
      return { x: mx, y: my };
    };
    /**
     * Copy a native-space track feature into display space for the edit
     * layer (identity passthrough when this camera renders unwarped), so
     * edit handles land on the warped imagery. The stored feature is never
     * mutated (decision D3: storage stays native).
     */
    function featureToDisplay(feature: Feature | null): Feature | null {
      const matrix = alignedDisplayTransform.value;
      if (!matrix || !feature) {
        return feature;
      }
      const mapped: Feature = { ...feature };
      const rotation = getRotationFromAttributes(feature.attributes);
      if (feature.bounds) {
        if (rotation !== undefined) {
          const rotated = mapRotatedBounds(matrix, feature.bounds, rotation);
          mapped.bounds = rotated.bounds;
          mapped.attributes = {
            ...feature.attributes,
            [ROTATION_ATTRIBUTE_NAME]: rotated.rotation,
          };
        } else {
          mapped.bounds = mapBounds(matrix, feature.bounds);
        }
      }
      if (feature.geometry) {
        mapped.geometry = {
          ...feature.geometry,
          features: mapGeoJSONFeatures(matrix, feature.geometry.features),
        };
      }
      return mapped;
    }

    // Created before the annotation layers below so its geojs layer z-orders
    // beneath boxes/polygons/text (geojs stacks layers by creation order).
    const alignedImageLayer = new AlignedImageLayer({
      annotator,
      getImage: () => {
        try {
          return getCameraImage(props.camera);
        } catch {
          // Controllers may be cleared mid-poll during a dataset reload.
          return null;
        }
      },
      getTransform: () => alignedDisplayTransform.value,
      // Right-click means "remove last point" while creating/editing
      // geometry; recenter everywhere else.
      getRecenterEnabled: () => !editingModeRef.value,
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

    // Watch for segmentation points updates - only show points for the current
    // frame, and only on the selected camera. The prompt points belong to the
    // image being segmented; without the camera check every camera rendered
    // them at the same pixel coordinates, which looked like an (unwarped)
    // point being created on the other camera.
    watch([segmentationPointsRef, frameNumberRef, selectedCamera], ([newPoints, currentFrame, currentCamera]) => {
      if (newPoints.points.length > 0 && newPoints.frameNum === currentFrame
        && props.camera === currentCamera) {
        // Prompt points are stored in native image space; render them where
        // the warped imagery actually is (identity when unwarped).
        const displayPoints = newPoints.points.map((p): [number, number] => {
          const { x, y } = mapDisplayPoint(p[0], p[1]);
          return [x, y];
        });
        segmentationPointsLayer.updatePoints(displayPoints, newPoints.labels);
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
    // on this camera at this frame (the user is mid-creation). Used to mirror the
    // creation cursor onto non-selected cameras so a new detection can be drawn
    // on any camera. Must look up the track on props.camera (same as
    // cameraAwaitingGeometry): `frame` is this layer's local frame, and under an
    // aligned timeline that diverges from selectedCamera's local frame.
    function isCreatingNewDetection(frame: number, trackId: AnnotationId | null): boolean {
      if (trackId === null) return false;
      const t = cameraStore.getPossibleTrack(trackId, props.camera);
      if (!t) return false;
      return t.getFeature(frame)[0] == null;
    }

    // True when, while editing, the selected track has no geometry on THIS
    // camera at this frame (the track may not exist on this camera at all).
    // For Point mode (point-click segmentation) and Polygon mode, "no geometry"
    // means no polygon at the selected key here yet, so a detection that only
    // has a box still accepts a draw.
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
      if (editingTrack === 'Point' || editingTrack === 'Polygon') {
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
     * Disables every annotation/edit layer without touching stored track
     * data. Used when this camera has no frame at the current aligned-
     * timeline slot (hasFrameRef false) -- frameNumberRef still holds the
     * last real local frame, so leaving the layers as-is would draw stale
     * boxes over a blank pane.
     */
    function disableAllLayers() {
      rectAnnotationLayer.disable();
      overlapLayer.disable();
      polyAnnotationLayer.disable();
      lineLayer.disable();
      pointLayer.disable();
      tailLayer.disable();
      textLayer.disable();
      attributeLayer.disable();
      attributeBoxLayer.disable();
      editAnnotationLayer.disable();
      segmentationPointsLayer.clear();
      hoverOvered.value = [];
      uiLayer.setToolTipWidget('customToolTip', false);
    }

    /** Re-runs updateLayers with current ref values, or blanks the layers when this camera has no frame at the current aligned-timeline slot. */
    function refreshLayers() {
      if (!hasFrameRef.value) {
        disableAllLayers();
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
    }

    watch(hasFrameRef, () => refreshLayers());

    /**
     * TODO: for some reason, GeoJS requires us to initialize
     * by calling the render function twice.  This is a bug.
     * https://github.com/Kitware/dive/issues/365
     */
    [1, 2].forEach(() => {
      refreshLayers();
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

    /**
     * Apply (or clear) the aligned-view display transform: warp the imagery
     * quad and point every geometry layer's draw-time mapping at the same
     * matrix, then re-render. Immediate so a LayerManager created while the
     * aligned view is already on (e.g. a view-mode switch) starts warped.
     */
    watch(alignedDisplayTransform, (matrix) => {
      displayTransformedLayers.forEach((layer) => layer.setDisplayTransform(matrix));
      alignedImageLayer.update();
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
    }, { immediate: true });

    // The warped imagery must follow frame changes: the annotator swaps its
    // <img> element asynchronously after each seek, and AlignedImageLayer
    // polls briefly after every trigger to catch that swap. Guarded so this
    // is a strict no-op whenever the camera renders unwarped.
    watch(frameNumberRef, () => {
      if (alignedDisplayTransform.value) {
        alignedImageLayer.update();
      }
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
        refreshLayers();
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
        refreshLayers();
      }, 0);
    });
    // Handle right-click outside polygons to finalize/cancel creation
    polyAnnotationLayer.bus.$on('polygon-right-clicked-outside', () => {
      if (editAnnotationLayer.getMode() === 'creation') {
        // Cancel creation and go back to editing the default polygon
        handler.cancelCreation();
        handler.selectFeatureHandle(-1, '');
        window.setTimeout(() => {
          refreshLayers();
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
      if (props.camera !== selectedCamera.value
        && (cameraAwaitingGeometry(frameNumberRef.value, selectedTrackIdRef.value, editingModeRef.value, selectedKeyRef.value)
          || isCreatingNewDetection(frameNumberRef.value, selectedTrackIdRef.value))) {
        // Draw landed on a camera that is not selected. Create the same-id
        // track here when needed, then switch so the update below commits on
        // this camera under the current track id. Check cameraAwaitingGeometry
        // before isCreatingNewDetection: once an empty track exists on this
        // camera the latter is also true, but trackAdd() would deselect and
        // start a new id. For Point mode, selectCamera finalizes the source
        // camera's pending mask and clears recipe prompt points.
        const trackId = selectedTrackIdRef.value as number;
        if (!cameraStore.getPossibleTrack(trackId, props.camera)) {
          const anyTrack = cameraStore.getAnyPossibleTrack(trackId);
          const trackType = anyTrack?.confidencePairs?.[0]?.[0] || 'unknown';
          trackStore.add(frameNumberRef.value, trackType, undefined, trackId);
        }
        // preserveSelection: the source camera's track may have no geometry yet
        // (the draw is happening here), so selectCamera must not abort it and
        // null selectedTrackId — the in-progress draw commits under this id.
        handler.selectCamera(props.camera, false, true);
        if (editingModeRef.value === 'Point' && selectedCamera.value !== props.camera) {
          // The switch was blocked (e.g. linking mode): a segmentation point
          // clicked on this camera must never be added to the selected
          // camera's prompt points, so drop the click.
          return;
        }
      } else if (props.camera !== selectedCamera.value
        && editingModeRef.value && selectedTrackIdRef.value !== null
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
      // Under the aligned view this camera renders warped, so the draw/edit
      // just made lives in display (reference) space: map it back to this
      // camera's native space before committing to track storage (decision
      // D3 -- storage stays native). Identity when the camera is unwarped.
      const inverse = alignedDisplayInverse.value;
      if (type === 'rectangle') {
        let bounds = geojsonToBound(data as GeoJSON.Feature<GeoJSON.Polygon>);
        // Extract rotation from properties if it exists
        let rotation = data.properties && isRotationValue(data.properties?.[ROTATION_ATTRIBUTE_NAME])
          ? data.properties[ROTATION_ATTRIBUTE_NAME] as number
          : undefined;
        if (inverse) {
          if (rotation !== undefined) {
            const mapped = mapRotatedBounds(inverse, bounds, rotation);
            bounds = mapped.bounds;
            rotation = mapped.rotation;
          } else {
            bounds = mapBounds(inverse, bounds);
          }
        }
        cb();
        handler.updateRectBounds(frameNumberRef.value, flickNumberRef.value, bounds, rotation);
      } else {
        const nativeData = inverse ? mapGeoJSONFeatures(inverse, [data])[0] : data;
        handler.updateGeoJSON(mode, frameNumberRef.value, flickNumberRef.value, nativeData, key, cb);
      }
      // Jump into edit mode if we completed a new shape
      if (geometryCompleteEvent) {
        // Suppress the select that rides along with this same finalizing click.
        justFinalizedCreation = true;
        window.setTimeout(() => { justFinalizedCreation = false; }, 0);
        refreshLayers();
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
      // Check which polygon was clicked by iterating through formatted data.
      // The click arrives in display space while formattedData is native, so
      // map it back through the aligned-view inverse (identity when unwarped).
      const inverse = alignedDisplayInverse.value;
      const point: [number, number] = inverse
        ? applyHomography(inverse, [geo.x, geo.y])
        : [geo.x, geo.y];
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
          refreshLayers();
        }, 0);
      }
    });
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
