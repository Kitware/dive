<script lang="ts">
import {
  defineComponent,
  computed,
  PropType,
  inject,
  Ref,
  watch,
} from '@vue/composition-api';

import { FrameDataTrack } from '@/components/layers/LayerTypes';
import Track, { TrackId } from '@/lib/track';
import IntervalTree from '@flatten-js/interval-tree';

import AnnotationLayer from '@/components/layers/AnnotationLayer';
import HTMLLayer from '@/components/layers/HTMLLayer';
import { Annotator } from '@/components/annotators/annotatorType';
import TextLayer from '@/components/layers/TextLayer';
import EditAnnotationLayer from '@/components/layers/EditAnnotationLayer';
import MarkerLayer from '@/components/layers/MarkerLayer';
import { geojsonToBound } from '@/utils';
import { FeaturePointingTarget } from '@/use/useFeaturePointing';
import { StateStyles, TypeStyling } from '@/use/useStyling';

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
  },

  setup(props, { emit }) {
    const annotator = inject('annotator') as Annotator;
    const frameNumber: Readonly<Ref<number>> = computed(() => annotator.frame as number);


    const annotationLayer = new AnnotationLayer({
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
      editing: 'rectangle',
    });
    const htmlLayer = new HTMLLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });

    const markerEditLayer = new EditAnnotationLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
      editing: 'point',
    });

    const markerLayer = new MarkerLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeStyling: props.typeStyling,
    });

    function updateLayers() {
      const frame = frameNumber.value;
      const editingTrack = props.editingTrack.value;
      const selectedTrackId = props.selectedTrackId.value;
      const tracks = props.tracks.value;
      const featurePointing = props.featurePointing.value;
      // Bug in interval search tree requires own return function for 0 values
      const currentFrameIds: TrackId[] = props.intervalTree.search(
        [frame, frame],
        (value) => (value !== null ? value : null),
      );
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

      annotationLayer.changeData(frameData);
      textLayer.changeData(frameData);
      markerLayer.changeData(frameData);

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
            //editAnnotationLayer.changeData(editingTracks);
            htmlLayer.changeData(editingTracks);
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
      props.tracks,
      props.editingTrack,
      props.selectedTrackId,
      props.featurePointing,
    ], () => {
      updateLayers();
    });


    const Clicked = (trackId: number, editing: boolean) => {
      if (!props.featurePointing.value) {
        editAnnotationLayer.disable();
        emit('selectTrack', trackId, editing);
      }
    };
    annotationLayer.$on('annotationClicked', Clicked);
    annotationLayer.$on('annotationRightClicked', Clicked);

    editAnnotationLayer.$on('update:geojson',
      (data: GeoJSON.Feature<GeoJSON.Polygon>) => {
        const bounds = geojsonToBound(data);
        emit('update-rect-bounds', frameNumber.value, bounds);
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
