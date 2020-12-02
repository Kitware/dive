<script lang="ts">
import {
  defineComponent,
  computed,
  inject,
  watch,
} from '@vue/composition-api';

import { FilteredTrack } from 'vue-media-annotator/use/useTrackFilters';
import { Annotator } from './annotators/annotatorType';
import RectangleLayer from '../layers/AnnotationLayers/RectangleLayer';
import PolygonLayer from '../layers/AnnotationLayers/PolygonLayer';
import PointLayer from '../layers/AnnotationLayers/PointLayer';
import LineLayer from '../layers/AnnotationLayers/LineLayer';

import EditAnnotationLayer, { EditAnnotationTypes } from '../layers/EditAnnotationLayer';
import { FrameDataTrack } from '../layers/LayerTypes';
import TextLayer from '../layers/TextLayer';
import { TrackId } from '../track';
import { geojsonToBound } from '../utils';
import { VisibleAnnotationTypes } from '../layers';

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
} from '../provides';


/** LayerManager is a component intended to be used as a child of an Annotator.
 *  It provides logic for switching which layers are visible, but more importantly
 *  it maps Track objects into their respective layer representations.
 *  LayerManager emits high-level events when track features get selected or updated.
 */
export default defineComponent({
  setup() {
    const handler = useHandler();
    const intervalTree = useIntervalTree();
    const trackMap = useTrackMap();
    const filteredTracksRef = useEnabledTracks();
    const selectedTrackIdRef = useSelectedTrackId();
    const typeStylingRef = useTypeStyling();
    const editingModeRef = useEditingMode();
    const visibleModesRef = useVisibleModes();
    const selectedKeyRef = useSelectedKey();
    const stateStyling = useStateStyles();

    const annotator = inject('annotator') as Annotator;
    const frameNumberRef = computed(() => annotator.frame);

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
    });

    const editAnnotationLayer = new EditAnnotationLayer({
      annotator,
      stateStyling,
      typeStyling: typeStylingRef,
      type: 'rectangle',
    });

    function updateLayers(
      frame: number,
      editingTrack: false | EditAnnotationTypes,
      selectedTrackId: TrackId | null,
      filteredTracks: readonly FilteredTrack[],
      visibleModes: readonly VisibleAnnotationTypes[],
      selectedKey: string,
    ) {
      const currentFrameIds: TrackId[] = intervalTree
        .search([frame, frame])
        .map((str: string) => parseInt(str, 10));

      const frameData = [] as FrameDataTrack[];
      const editingTracks = [] as FrameDataTrack[];
      currentFrameIds.forEach(
        (trackId: TrackId) => {
          const track = trackMap.get(trackId);
          if (track === undefined) {
            throw new Error(`TrackID ${trackId} not found in map`);
          }
          const filteredIndex = filteredTracks.findIndex(
            (filtered) => filtered.track.trackId === track.trackId,
          );
          if (filteredIndex !== -1) {
            const [features] = track.getFeature(frame);
            const trackFrame = {
              selected: (selectedTrackId === track.trackId),
              editing: editingTrack,
              trackId: track.trackId,
              features,
              trackType: track.getType(
                filteredTracks[filteredIndex].context.confidencePairIndex,
              ),
              confidencePairs: track.confidencePairs,
            };
            frameData.push(trackFrame);
            if (frameData[frameData.length - 1].selected && (editingTrack)) {
              editingTracks.push(trackFrame);
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
          const filteredIndex = filteredTracks.findIndex(
            (filtered) => filtered.track.trackId === editTrack.trackId,
          );

          const [real, lower, upper] = editTrack.getFeature(frame);
          const features = real || lower || upper;
          const trackFrame = {
            selected: true,
            editing: true,
            trackId: editTrack.trackId,
            features: (features && features.interpolate) ? features : null,
            trackType: editTrack.getType(
              filteredTracks[filteredIndex].context.confidencePairIndex,
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
     * https://github.com/VIAME/VIAME-Web/issues/365
     */
    [1, 2].forEach(() => {
      updateLayers(
        frameNumberRef.value,
        editingModeRef.value,
        selectedTrackIdRef.value,
        filteredTracksRef.value,
        visibleModesRef.value,
        selectedKeyRef.value,
      );
    });

    watch([
      frameNumberRef,
      editingModeRef,
      filteredTracksRef,
      selectedTrackIdRef,
      visibleModesRef,
      typeStylingRef,
    ], () => {
      updateLayers(
        frameNumberRef.value,
        editingModeRef.value,
        selectedTrackIdRef.value,
        filteredTracksRef.value,
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
        handler.updateRectBounds(frameNumberRef.value, bounds);
      } else {
        handler.updateGeoJSON(mode, frameNumberRef.value, data, key, cb);
      }
      // Jump into edit mode if we completed a new shape
      if (geometryCompleteEvent) {
        updateLayers(
          frameNumberRef.value,
          editingModeRef.value,
          selectedTrackIdRef.value,
          filteredTracksRef.value,
          visibleModesRef.value,
          selectedKeyRef.value,
        );
      }
    });
    editAnnotationLayer.bus.$on('update:selectedIndex',
      (index: number, _type: EditAnnotationTypes, key = '') => handler.selectFeatureHandle(index, key));
  },
});
</script>

<template>
  <div />
</template>
