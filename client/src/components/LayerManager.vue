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
import { FrameDataTrack } from '../layers/LayerTypes';
import TextLayer, { FormatTextRow } from '../layers/AnnotationLayers/TextLayer';
import AttributeLayer from '../layers/AnnotationLayers/AttributeLayer';
import AttributeBoxLayer from '../layers/AnnotationLayers/AttributeBoxLayer';
import type { AnnotationId } from '../BaseAnnotation';
import { geojsonToBound } from '../utils';
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
    const cameraStore = useCameraStore();
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

    const textLayer = new TextLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
      formatter: props.formatTextRow,
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

    // Segmentation points layer for displaying prompt points during point-click segmentation
    const segmentationPointsRef = useSegmentationPoints();
    const segmentationPointsLayer = new SegmentationPointsLayer(annotator);

    // Watch for segmentation points updates - only show points for current frame
    watch([segmentationPointsRef, frameNumberRef], ([newPoints, currentFrame]) => {
      // Only display points if they belong to the current frame
      if (newPoints.points.length > 0 && newPoints.frameNum === currentFrame) {
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
              if (editingTrack && props.camera === selectedCamera.value) {
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

    const Clicked = (trackId: number, editing: boolean, modifiers?: {ctrl: boolean}) => {
      // If the camera isn't selected yet we ignore the click
      if (selectedCamera.value !== props.camera) {
        return;
      }
      //So we only want to pass the click whjen not in creation mode or editing mode for features
      if (editAnnotationLayer.getMode() !== 'creation') {
        editAnnotationLayer.disable();
        handler.trackSelect(trackId, editing, modifiers);
      }
    };

    //Sync of internal geoJS state with the application
    editAnnotationLayer.bus.$on('editing-annotation-sync', (editing: boolean) => {
      handler.trackSelect(selectedTrackIdRef.value, editing);
    });
    // Handle right-click to confirm/lock annotation in Point mode (segmentation)
    editAnnotationLayer.bus.$on('confirm-annotation', () => {
      handler.confirmRecipe();
    });
    rectAnnotationLayer.bus.$on('annotation-clicked', Clicked);
    rectAnnotationLayer.bus.$on('annotation-right-clicked', Clicked);
    rectAnnotationLayer.bus.$on('annotation-ctrl-clicked', Clicked);
    polyAnnotationLayer.bus.$on('annotation-clicked', Clicked);
    polyAnnotationLayer.bus.$on('annotation-right-clicked', Clicked);
    // Handle right-click polygon selection for multi-polygon support
    polyAnnotationLayer.bus.$on('polygon-right-clicked', (_trackId: number, polygonKey: string) => {
      // Don't switch polygons when in creation mode (e.g., drawing a hole)
      if (editAnnotationLayer.getMode() === 'creation') {
        return;
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
    // Handle polygon selection for multi-polygon support
    polyAnnotationLayer.bus.$on('polygon-clicked', (_trackId: number, polygonKey: string) => {
      // Don't switch polygons when in creation mode (e.g., drawing a hole)
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
    editAnnotationLayer.bus.$on('update:geojson', (
      mode: 'in-progress' | 'editing',
      geometryCompleteEvent: boolean,
      data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>,
      type: string,
      key = '',
      cb: () => void = () => (undefined),
    ) => {
      if (type === 'rectangle') {
        const bounds = geojsonToBound(data as GeoJSON.Feature<GeoJSON.Polygon>);
        cb();
        handler.updateRectBounds(frameNumberRef.value, flickNumberRef.value, bounds);
      } else {
        handler.updateGeoJSON(mode, frameNumberRef.value, flickNumberRef.value, data, key, cb);
      }
      // Jump into edit mode if we completed a new shape
      if (geometryCompleteEvent) {
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
  },
});
</script>

<template>
  <div />
</template>
