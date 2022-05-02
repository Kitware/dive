<script lang="ts">
import {
  defineComponent, watch, PropType, Ref, ref, computed,
} from '@vue/composition-api';

import { TrackWithContext } from '../BaseFilterControls';
import { injectMediaController } from './annotators/useMediaController';
import RectangleLayer from '../layers/AnnotationLayers/RectangleLayer';
import PolygonLayer from '../layers/AnnotationLayers/PolygonLayer';
import PointLayer from '../layers/AnnotationLayers/PointLayer';
import LineLayer from '../layers/AnnotationLayers/LineLayer';
import TailLayer from '../layers/AnnotationLayers/TailLayer';

import EditAnnotationLayer, { EditAnnotationTypes } from '../layers/EditAnnotationLayer';
import { FrameDataTrack } from '../layers/LayerTypes';
import TextLayer, { FormatTextRow } from '../layers/AnnotationLayers/TextLayer';
import type { AnnotationId } from '../BaseAnnotation';
import { geojsonToBound } from '../utils';
import { VisibleAnnotationTypes } from '../layers';
import UILayer from '../layers/UILayers/UILayer';
import ToolTipWidget from '../layers/UILayers/ToolTipWidget.vue';
import { ToolTipWidgetData } from '../layers/UILayers/UILayerTypes';
import {
  useHandler,
  useTrackStore,
  useSelectedTrackId,
  useTrackFilters,
  useTrackStyleManager,
  useEditingMode,
  useVisibleModes,
  useSelectedKey,
  useMergeList,
  useAnnotatorPreferences,
  useGroupStyleManager,
  useGroupStore,
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
    colorBy: {
      type: String as PropType<'group' | 'track'>,
      default: 'track',
    },
  },
  setup(props) {
    const handler = useHandler();
    const trackStore = useTrackStore();
    const groupStore = useGroupStore();
    const enabledTracksRef = useTrackFilters().enabledAnnotations;
    const selectedTrackIdRef = useSelectedTrackId();
    const mergeListRef = useMergeList();
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

    const annotator = injectMediaController();
    const frameNumberRef = annotator.frame;
    const flickNumberRef = annotator.flick;

    const rectAnnotationLayer = new RectangleLayer({
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

    const editAnnotationLayer = new EditAnnotationLayer({
      annotator,
      stateStyling: trackStyleManager.stateStyles,
      typeStyling: typeStylingRef,
      type: 'rectangle',
    });

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
      mergeList: readonly AnnotationId[],
      enabledTracks: readonly TrackWithContext[],
      visibleModes: readonly VisibleAnnotationTypes[],
      selectedKey: string,
      colorBy: string,
    ) {
      const currentFrameIds: AnnotationId[] = trackStore.intervalTree
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
        (trackId: AnnotationId) => {
          const track = trackStore.get(trackId);
          const enabledIndex = enabledTracks.findIndex(
            (trackWithContext) => trackWithContext.annotation.id === trackId,
          );
          if (enabledIndex !== -1) {
            const [features] = track.getFeature(frame);
            const groups = groupStore.lookupGroups(track.id);
            const trackStyleType = track.getType(
              enabledTracks[enabledIndex].context.confidencePairIndex,
            );
            const groupStyleType = groups?.[0]?.getType() ?? groupStore.defaultGroup;
            const trackFrame = {
              selected: ((selectedTrackId === track.trackId)
                || (mergeList.includes(track.trackId))),
              editing: editingTrack,
              track,
              groups,
              features,
              styleType: colorBy === 'group' ? groupStyleType : trackStyleType,
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
      pointLayer.changeData(frameData);
      if (visibleModes.includes('text')) {
        textLayer.changeData(frameData);
      } else {
        textLayer.disable();
      }

      if (selectedTrackId !== null) {
        if ((editingTrack) && !currentFrameIds.includes(selectedTrackId)) {
          const editTrack = trackStore.get(selectedTrackId);
          // const enabledIndex = enabledTracks.findIndex(
          //   (trackWithContext) => trackWithContext.annotation.id === editTrack.id,
          // );
          const [real, lower, upper] = editTrack.getFeature(frame);
          const features = real || lower || upper;
          const trackFrame = {
            selected: true,
            editing: true,
            track: editTrack,
            groups: groupStore.lookupGroups(editTrack.id),
            features: (features && features.interpolate) ? features : null,
            styleType: groupStore.defaultGroup, // Won't be used
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
        mergeListRef,
        visibleModesRef,
        typeStylingRef,
        props.colorBy,
      ],
      () => {
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          mergeListRef.value,
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
          mergeListRef.value,
          enabledTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
          props.colorBy,
        );
      },
      { deep: true },
    );

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
          props.colorBy,
        );
      }
    });
    editAnnotationLayer.bus.$on('update:selectedIndex',
      (index: number, _type: EditAnnotationTypes, key = '') => handler.selectFeatureHandle(index, key));
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
