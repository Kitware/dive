<script lang="ts">
import {
  defineComponent,
  computed,
  PropType,
  inject,
  Ref,
  watch,
} from '@vue/composition-api';
import { uniq } from 'lodash';

import { FrameDataTrack } from '@/components/layers/LayerTypes';
import Track, { TrackId } from '@/lib/track';
import IntervalTree from '@flatten-js/interval-tree';

import AnnotationLayer from '@/components/layers/AnnotationLayer';
import RectangleLayer from '@/components/layers/AnnotationLayers/RectangleLayer';
import PolygonLayer from '@/components/layers/AnnotationLayers/PolygonLayer';
import PointLayer from '@/components/layers/AnnotationLayers/PointLayer';
import LineLayer from '@/components/layers/AnnotationLayers/LineLayer';
import { Annotator } from '@/components/annotators/annotatorType';
import TextLayer from '@/components/layers/TextLayer';
import EditAnnotationLayer, { EditAnnotationTypes } from '@/components/layers/EditAnnotationLayer';
import MarkerLayer from '@/components/layers/MarkerLayer';
import { geojsonToBound } from '@/utils';
import { FeaturePointingTarget } from '@/use/useFeaturePointing';
import { StateStyles, TypeStyling } from '@/use/useStyling';
import { EditorSettings } from '@/use/useModeManager';

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
    editingTrack: {
      type: Object as PropType<Ref<boolean>>,
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
    featurePointing: {
      type: Object as PropType<Ref<boolean>>,
      required: true,
    },
    featurePointingTarget: {
      type: Object as PropType<Ref<FeaturePointingTarget>>,
      required: true,
    },
    annotationModes: {
      type: Object as PropType<EditorSettings>,
      required: true,
    },
  },

  setup(props, { emit }) {
    const annotator = inject('annotator') as Annotator;
    const frameNumber: Readonly<Ref<number>> = computed(() => annotator.frame as number);

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

    const markerLayer = new PointLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });

    const lineLayer = new LineLayer({
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

    const markerEditLayer = new EditAnnotationLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
      type: 'point',
    });


    const editingType: Ref<false|EditAnnotationTypes> = computed(() => (
      props.editingTrack.value && props.annotationModes.state.value.editing
    ));

    const annotationVisible = computed(() => uniq(props.annotationModes.state.value.visible.concat(
      props.editingTrack.value ? [props.annotationModes.state.value.editing] : [],
    )));

    function updateLayers() {
      const frame = frameNumber.value;
      const editingTrack = editingType.value;
      const selectedTrackId = props.selectedTrackId.value;
      const tracks = props.tracks.value;
      const featurePointing = props.featurePointing.value;
      const annotationVisible_ = annotationVisible.value;
      // Bug in interval search tree requires own return function for 0 values
      const currentFrameIds: TrackId[] = props.intervalTree.search(
        [frame, frame],
        (value) => (value !== null ? value : null),
      );

      if (editingTrack) {
        editAnnotationLayer.setType(editingTrack);
      }
      //If it is editing tracks we need to set the edit mode
      // Possibly include editing track or selected track
      // even if it's not in range.
      // if (sele!currentFrameIds.indexOf())
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
            if (frameData[frameData.length - 1].selected && (editingTrack || featurePointing)) {
              editingTracks.push(trackFrame);
            }
          }
        },
      );

      if (annotationVisible_.includes('rectangle')) {
        //We modify rects opacity/thickness if polygons are visible or not
        rectAnnotationLayer.setDrawingOther(annotationVisible_.includes('polygon'));
        rectAnnotationLayer.changeData(frameData);
      } else {
        rectAnnotationLayer.disable();
      }
      if (annotationVisible_.includes('polygon')) {
        polyAnnotationLayer.setDrawingOther(annotationVisible_.includes('rectangle'));
        polyAnnotationLayer.changeData(frameData);
      } else {
        polyAnnotationLayer.disable();
      }
      markerLayer.changeData(frameData);
      lineLayer.changeData(frameData);
      if (annotationVisible_.length) {
        textLayer.changeData(frameData);
      } else {
        textLayer.disable();
      }

      if (selectedTrackId !== null) {
        if ((editingTrack || featurePointing) && !currentFrameIds.includes(selectedTrackId)) {
          const editTrack = props.trackMap.get(selectedTrackId);
          if (editTrack === undefined) {
            throw new Error(`trackMap missing trackid ${selectedTrackId}`);
          }
          const [real, lower, upper] = editTrack.getFeature(frameNumber.value);
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
          if (featurePointing) {
            // Marker shouldn't be edited when creating a new track
            const hasBounds = editingTracks.filter((item) => item.features && item.features.bounds);
            if (!editingTrack || (editingTrack && hasBounds.length)) {
              markerEditLayer.changeData([]);
            }
          }
        } else {
          markerEditLayer.disable();
          editAnnotationLayer.disable();
        }
      } else {
        markerEditLayer.disable();
        editAnnotationLayer.disable();
      }
    }

    updateLayers();

    watch([
      frameNumber,
      annotationVisible,
      props.tracks,
      props.editingTrack,
      props.selectedTrackId,
      props.featurePointing,
    ], () => {
      updateLayers();
    });


    const Clicked = (trackId: number, editing: boolean) => {
      //So we only want to pass the click when not in creation mode or editing mode for features
      const creationMode = editAnnotationLayer.getMode() === 'creation';
      const editingPolyorLine = (editingType.value && (editingType.value === 'polygon' || editingType.value === 'line'));
      if (!props.featurePointing.value && !(editingPolyorLine && creationMode)) {
        editAnnotationLayer.disable();
        emit('selectTrack', trackId, editing);
      }
    };
    rectAnnotationLayer.$on('annotationClicked', Clicked);
    rectAnnotationLayer.$on('annotationRightClicked', Clicked);
    polyAnnotationLayer.$on('annotationClicked', Clicked);
    polyAnnotationLayer.$on('annotationRightClicked', Clicked);

    editAnnotationLayer.$on('update:geojson',
      (data: GeoJSON.Feature<GeoJSON.Polygon>, type: string) => {
        if (type === 'rectangle') {
          const bounds = geojsonToBound(data);
          emit('update-rect-bounds', frameNumber.value, bounds);
        } else if (type === 'polygon') {
          emit('update-polygon', frameNumber.value, data);
        }
      });

    //Selecting an index so it can be removed
    editAnnotationLayer.$on('update:selectedIndex', (index: number) => {
      emit('select-feature-handle', index);
    });

    markerEditLayer.$on('update:geojson', (data: GeoJSON.Feature<GeoJSON.Point>) => {
      emit('featurePointUpdated', frameNumber.value, data);
    });

    return {
      props,
    };
  },
});
</script>

<template>
  <div />
</template>
