<script lang="ts">
import IntervalTree from '@flatten-js/interval-tree';
import {
  defineComponent,
  computed,
  PropType,
  inject,
  Ref,
  watch,
} from '@vue/composition-api';

import { Annotator } from 'vue-media-annotator/components/annotators/annotatorType';
import RectangleLayer from 'vue-media-annotator/layers/AnnotationLayers/RectangleLayer';
import PolygonLayer from 'vue-media-annotator/layers/AnnotationLayers/PolygonLayer';
import PointLayer from 'vue-media-annotator/layers/AnnotationLayers/PointLayer';
import LineLayer from 'vue-media-annotator/layers/AnnotationLayers/LineLayer';

import EditAnnotationLayer, { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';
import { FrameDataTrack } from 'vue-media-annotator/layers/LayerTypes';
import TextLayer from 'vue-media-annotator/layers/TextLayer';
import Track, { TrackId } from 'vue-media-annotator/track';
import { geojsonToBound } from 'vue-media-annotator/utils';
import { StateStyles, TypeStyling } from 'vue-media-annotator/use/useStyling';

/** LayerManager is a component intended to be used as a child of an Annotator.
 *  It provides logic for switching which layers are visible, but more importantly
 *  it maps Track objects into their respective layer representations.
 *  LayerManager emits high-level events when track features get selected or updated.
 */
export default defineComponent({
  props: {
    trackMap: {
      type: Map as PropType<Map<TrackId, Track>>,
      required: true,
    },
    tracks: {
      type: Object as PropType<Ref<Track[]>>,
      required: true,
    },
    intervalTree: {
      type: Object as PropType<IntervalTree>,
      required: true,
    },
    selectedTrackId: {
      type: Object as PropType<Ref<TrackId>>,
      required: true,
    },
    typeStyling: {
      type: Object as PropType<Ref<TypeStyling>>,
      required: true,
    },
    stateStyling: {
      type: Object as PropType<StateStyles>,
      required: true,
    },
    editingMode: {
      type: Object as PropType<Ref<false|EditAnnotationTypes>>,
      required: true,
    },
    visibleModes: {
      type: Object as PropType<Ref<EditAnnotationTypes[]>>,
      required: true,
    },
    selectedKey: {
      type: Object as PropType<Ref<string>>,
      required: true,
    },
  },

  setup(props, { emit }) {
    const annotator = inject('annotator') as Annotator;
    const frameNumber = computed(() => annotator.frame);

    const rectAnnotationLayer = new RectangleLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });
    const polyAnnotationLayer = new PolygonLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });

    const lineLayer = new LineLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });
    const pointLayer = new PointLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });


    const textLayer = new TextLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });

    const editAnnotationLayer = new EditAnnotationLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
      type: 'rectangle',
    });

    function updateLayers(
      frame: number,
      editingTrack: false | EditAnnotationTypes,
      selectedTrackId: TrackId,
      tracks: Track[],
      visibleModes: EditAnnotationTypes[],
      selectedKey: string,
    ) {
      const currentFrameIds: TrackId[] = props.intervalTree
        .search([frame, frame])
        .map((str: string) => parseInt(str, 10));

      if (editingTrack) {
        editAnnotationLayer.setType(editingTrack);
        editAnnotationLayer.setKey(selectedKey);
      }

      const frameData = [] as FrameDataTrack[];
      const editingTracks = [] as FrameDataTrack[];
      currentFrameIds.forEach(
        (trackId: TrackId) => {
          const track = props.trackMap.get(trackId);
          if (track === undefined) {
            throw new Error(`TrackID ${trackId} not found in map`);
          }
          if (tracks.includes(track)) {
            const [features] = track.getFeature(frame);
            const trackFrame = {
              selected: (selectedTrackId === track.trackId),
              editing: editingTrack,
              trackId: track.trackId,
              features,
              confidencePairs: track.getType(),
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
      if (visibleModes.length) {
        textLayer.changeData(frameData);
      } else {
        textLayer.disable();
      }

      if (selectedTrackId !== null) {
        if ((editingTrack) && !currentFrameIds.includes(selectedTrackId)) {
          const editTrack = props.trackMap.get(selectedTrackId);
          if (editTrack === undefined) {
            throw new Error(`trackMap missing trackid ${selectedTrackId}`);
          }
          const [real, lower, upper] = editTrack.getFeature(frame);
          const features = real || lower || upper;
          const trackFrame = {
            selected: true,
            editing: true,
            trackId: editTrack.trackId,
            features: (features && features.interpolate) ? features : null,
            confidencePairs: editTrack.getType(),
          };
          editingTracks.push(trackFrame);
        }
        if (editingTracks.length) {
          if (editingTrack) {
            editAnnotationLayer.changeData(editingTracks);
            emit('editingModeChanged', editAnnotationLayer.getMode());
          }
        } else {
          editAnnotationLayer.disable();
        }
      } else {
        editAnnotationLayer.disable();
      }
    }

    updateLayers(
      frameNumber.value,
      props.editingMode.value,
      props.selectedTrackId.value,
      props.tracks.value,
      props.visibleModes.value,
      props.selectedKey.value,
    );

    watch([
      frameNumber,
      props.editingMode,
      props.tracks,
      props.selectedTrackId,
      props.visibleModes,
    ], () => {
      updateLayers(
        frameNumber.value,
        props.editingMode.value,
        props.selectedTrackId.value,
        props.tracks.value,
        props.visibleModes.value,
        props.selectedKey.value,
      );
    });

    const Clicked = (trackId: number, editing: boolean) => {
      //So we only want to pass the click whjen not in creation mode or editing mode for features
      const creationMode = editAnnotationLayer.getMode() === 'creation';
      const editingPolyorLine = (props.editingMode.value && (
        props.editingMode.value === 'Polygon' || props.editingMode.value === 'LineString' || props.editingMode.value === 'Point'));
      if (!(editingPolyorLine && creationMode)) {
        editAnnotationLayer.disable();
        emit('select-track', trackId, editing);
      }
    };
    rectAnnotationLayer.$on('annotation-clicked', Clicked);
    rectAnnotationLayer.$on('annotation-right-clicked', Clicked);
    polyAnnotationLayer.$on('annotation-clicked', Clicked);
    polyAnnotationLayer.$on('annotation-right-clicked', Clicked);

    editAnnotationLayer.$on('update:geojson',
      (data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>, type: string, key = '') => {
        if (type === 'rectangle') {
          const bounds = geojsonToBound(data as GeoJSON.Feature<GeoJSON.Polygon>);
          emit('update-rect-bounds', frameNumber.value, bounds);
        } else {
          emit('update-geojson', frameNumber.value, data, key);
        }
      });
    editAnnotationLayer.$on('update:in-progress-geojson',
      (data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString>) => emit('update-geojson', frameNumber.value, data));
    editAnnotationLayer.$on('update:selectedIndex',
      (index: number, _type: EditAnnotationTypes, key = '') => emit('select-feature-handle', index, key));
  },
});
</script>

<template>
  <div />
</template>
