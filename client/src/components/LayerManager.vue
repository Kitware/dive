<script lang="ts">
import {
  defineComponent, watch, PropType, Ref, ref,
} from '@vue/composition-api';

import { TrackWithContext } from '../use/useTrackFilters';
import { injectMediaController } from './annotators/useMediaController';
import RectangleLayer from '../layers/AnnotationLayers/RectangleLayer';
import PolygonLayer from '../layers/AnnotationLayers/PolygonLayer';
import PointLayer from '../layers/AnnotationLayers/PointLayer';
import LineLayer from '../layers/AnnotationLayers/LineLayer';

import EditAnnotationLayer, { EditAnnotationTypes } from '../layers/EditAnnotationLayer';
import { FrameDataTrack } from '../layers/LayerTypes';
import TextLayer, { FormatTextRow } from '../layers/AnnotationLayers/TextLayer';
import { TrackId } from '../track';
import { geojsonToBound } from '../utils';
import { VisibleAnnotationTypes } from '../layers';
import UILayer from '../layers/UILayers/UILayer';
import ToolTipWidget from '../layers/UILayers/ToolTipWidget.vue';
import { ToolTipWidgetData } from '../layers/UILayers/UILayerTypes';
import {
  useEnabledTracks,
  useHandler,
  useIntervalTree,
  useTrackMap,
  useSelectedTrackId,
  useTypeStyling,
  useEditingMode,
  useVisibleModes,
  useSelectedKey,
  useStateStyles,
  useMergeList,
} from '../provides';

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
  },
  setup(props) {
    const handler = useHandler();
    const intervalTree = useIntervalTree();
    const trackMap = useTrackMap();
    const enabledTracksRef = useEnabledTracks();
    const selectedTrackIdRef = useSelectedTrackId();
    const mergeListRef = useMergeList();
    const typeStylingRef = useTypeStyling();
    const editingModeRef = useEditingMode();
    const visibleModesRef = useVisibleModes();
    const selectedKeyRef = useSelectedKey();
    const stateStyling = useStateStyles();

    const annotator = injectMediaController();
    const frameNumberRef = annotator.frame;
    const flickNumberRef = annotator.flick;

    const rectAnnotationLayer = new RectangleLayer({
      annotator,
      stateStyling,
      typeStyling: typeStylingRef,
    });
    const polyAnnotationLayer = new PolygonLayer({
      annotator,
      stateStyling,
      typeStyling: typeStylingRef,
    });

    const lineLayer = new LineLayer({
      annotator,
      stateStyling,
      typeStyling: typeStylingRef,
    });
    const pointLayer = new PointLayer({
      annotator,
      stateStyling,
      typeStyling: typeStylingRef,
    });


    const textLayer = new TextLayer({
      annotator,
      stateStyling,
      typeStyling: typeStylingRef,
      formatter: props.formatTextRow,
    });

    const editAnnotationLayer = new EditAnnotationLayer({
      annotator,
      stateStyling,
      typeStyling: typeStylingRef,
      type: 'rectangle',
    });

    const uiLayer = new UILayer(annotator);
    const hoverOvered: Ref<ToolTipWidgetData[]> = ref([]);
    const toolTipWidgetProps = {
      color: typeStylingRef.value.color,
      dataList: hoverOvered,
      selected: selectedTrackIdRef,
      stateStyling,
    };
    uiLayer.addDOMWidget('customToolTip', ToolTipWidget, toolTipWidgetProps, { x: 10, y: 10 });

    function updateLayers(
      frame: number,
      editingTrack: false | EditAnnotationTypes,
      selectedTrackId: TrackId | null,
      mergeList: readonly TrackId[],
      enabledTracks: readonly TrackWithContext[],
      visibleModes: readonly VisibleAnnotationTypes[],
      selectedKey: string,
    ) {
      const currentFrameIds: TrackId[] = intervalTree
        .search([frame, frame])
        .map((str: string) => parseInt(str, 10));
      const inlcudesTooltip = visibleModes.includes('tooltip');
      rectAnnotationLayer.setHoverAnnotations(inlcudesTooltip);
      polyAnnotationLayer.setHoverAnnotations(inlcudesTooltip);
      if (!inlcudesTooltip) {
        hoverOvered.value = [];
      }
      const frameData = [] as FrameDataTrack[];
      const editingTracks = [] as FrameDataTrack[];
      currentFrameIds.forEach(
        (trackId: TrackId) => {
          const track = trackMap.get(trackId);
          if (track === undefined) {
            throw new Error(`TrackID ${trackId} not found in map`);
          }
          const enabledIndex = enabledTracks.findIndex(
            (trackWithContext) => trackWithContext.track.trackId === trackId,
          );
          if (enabledIndex !== -1) {
            const [features] = track.getFeature(frame);
            const trackFrame = {
              selected: ((selectedTrackId === track.trackId)
                || (mergeList.includes(track.trackId))),
              editing: editingTrack,
              trackId: track.trackId,
              features,
              trackType: track.getType(
                enabledTracks[enabledIndex].context.confidencePairIndex,
              ),
              confidencePairs: track.confidencePairs,
            };
            frameData.push(trackFrame);
            if (trackFrame.selected) {
              if (editingTrack) {
                editingTracks.push(trackFrame);
              }
              if (annotator.lockedCamera.value) {
                if (trackFrame.features?.bounds) {
                  const coords = {
                    x: (trackFrame.features.bounds[0] + trackFrame.features.bounds[2]) / 2.0,
                    y: (trackFrame.features.bounds[1] + trackFrame.features.bounds[3]) / 2.0,
                    z: 0,
                  };
                  annotator.centerOn(coords);
                }
              }
            }
          }
        },
      );

      if (visibleModes.includes('rectangle')) {
        //We modify rects opacity/thickness if polygons are visible or not
        rectAnnotationLayer.setDrawingOther(visibleModes.includes('Polygon'));
        rectAnnotationLayer.changeData(frameData);
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
      pointLayer.changeData(frameData);
      if (visibleModes.includes('text')) {
        textLayer.changeData(frameData);
      } else {
        textLayer.disable();
      }

      if (selectedTrackId !== null) {
        if ((editingTrack) && !currentFrameIds.includes(selectedTrackId)) {
          const editTrack = trackMap.get(selectedTrackId);

          if (editTrack === undefined) {
            throw new Error(`trackMap missing trackid ${selectedTrackId}`);
          }
          const enabledIndex = enabledTracks.findIndex(
            (trackWithContext) => trackWithContext.track.trackId === editTrack.trackId,
          );

          const [real, lower, upper] = editTrack.getFeature(frame);
          const features = real || lower || upper;
          const trackFrame = {
            selected: true,
            editing: true,
            trackId: editTrack.trackId,
            features: (features && features.interpolate) ? features : null,
            trackType: editTrack.getType(
              enabledTracks[enabledIndex].context.confidencePairIndex,
            ),
            confidencePairs: editTrack.confidencePairs,
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
        mergeListRef.value,
        enabledTracksRef.value,
        visibleModesRef.value,
        selectedKeyRef.value,
      );
    });

    watch([
      frameNumberRef,
      editingModeRef,
      enabledTracksRef,
      selectedTrackIdRef,
      mergeListRef,
      visibleModesRef,
      typeStylingRef,
    ], () => {
      updateLayers(
        frameNumberRef.value,
        editingModeRef.value,
        selectedTrackIdRef.value,
        mergeListRef.value,
        enabledTracksRef.value,
        visibleModesRef.value,
        selectedKeyRef.value,
      );
    });

    const Clicked = (trackId: number, editing: boolean) => {
      //So we only want to pass the click whjen not in creation mode or editing mode for features
      if (editAnnotationLayer.getMode() !== 'creation') {
        editAnnotationLayer.disable();
        handler.trackSelect(trackId, editing);
      }
    };


    //Sync of internal geoJS state with the application
    editAnnotationLayer.bus.$on('editing-annotation-sync', (editing: boolean) => {
      handler.trackSelect(selectedTrackIdRef.value, editing);
    });
    rectAnnotationLayer.bus.$on('annotation-clicked', Clicked);
    rectAnnotationLayer.bus.$on('annotation-right-clicked', Clicked);
    polyAnnotationLayer.bus.$on('annotation-clicked', Clicked);
    polyAnnotationLayer.bus.$on('annotation-right-clicked', Clicked);
    editAnnotationLayer.bus.$on('update:geojson', (
      mode: 'in-progress' | 'editing',
      geometryCompleteEvent: boolean,
      data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>,
      type: string,
      key = '',
      cb: () => void,
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
          mergeListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
        );
      }
    });
    editAnnotationLayer.bus.$on('update:selectedIndex',
      (index: number, _type: EditAnnotationTypes, key = '') => handler.selectFeatureHandle(index, key));
    const annotationHoverTooltip = (
      found: {
          trackType: [string, number];
          trackId: number;
          polygon: { coordinates: Array<Array<[number, number]>>};
        }[],
    ) => {
      const hoveredVals: (ToolTipWidgetData & { maxX: number})[] = [];
      found.forEach((item) => {
        // get Max of X and Min of y
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
            type: item.trackType[0],
            confidence: item.trackType[1],
            trackId: item.trackId,
            maxX,
          });
        }
      });
      hoverOvered.value = hoveredVals.sort((a, b) => a.maxX - b.maxX);
      uiLayer.setToolTipWidget('customToolTip', (found.length > 0));
    };
    rectAnnotationLayer.bus.$on('annotation-hover', annotationHoverTooltip);
    polyAnnotationLayer.bus.$on('annotation-hover', annotationHoverTooltip);
  },
});
</script>

<template>
  <div />
</template>
