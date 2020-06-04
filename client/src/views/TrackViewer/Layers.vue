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
import TextLayer from '@/components/layers/TextLayer';
import EditAnnotationLayer from '@/components/layers/EditAnnotationLayer';
import MarkerLayer from '@/components/layers/MarkerLayer';
import { geojsonToBound } from '@/utils';
import { FeaturePointingTarget } from '@/use/useFeaturePointing';


export default defineComponent({
  props: {
    trackMap: {
      type: Map as PropType<Map<TrackId, Track>>,
      required: true,
    },
    trackIds: {
      type: Object as PropType<Ref<Array<TrackId>>>,
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
    typeColorMapper: {
      type: Function as PropType<(t: string) => string>,
      required: true,
    },
    stateStyling: {
      type: Object,
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
    const annotator = inject('annotator') as unknown;
    const frameNumber: Readonly<Ref<number>> = computed(() => annotator.frame as number);


    const annotationLayer = new AnnotationLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeColorMap: props.typeColorMapper,
    });
    const textLayer = new TextLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeColorMap: props.typeColorMapper,
    });

    const editAnnotationLayer = new EditAnnotationLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeColorMap: props.typeColorMapper,
      editing: 'rectangle',
    });

    const markerEditLayer = new EditAnnotationLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeColorMap: props.typeColorMapper,
      editing: 'point',
    });


    const markerLayer = new MarkerLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeColorMap: props.typeColorMapper,
    });

    function updateLayers(updated = {}) {
      const frame = frameNumber.value;
      const editingTrack = props.editingTrack.value;
      const selectedTrackId = props.selectedTrackId.value;
      const trackIds = props.trackIds.value;
      const currentFrameIds = props.intervalTree.search([frame, frame]);
      const tracks = [] as FrameDataTrack[];
      const editingTracks = [] as FrameDataTrack[];
      currentFrameIds.forEach(
        (item: number) => {
          if (trackIds.includes(item)) {
            if (props.trackMap.has(item)) {
              const track = props.trackMap.get(item);
              if (track === undefined) {
                throw new Error(`trackMap missing trackid ${item}`);
              }
              const features = track.getFeature(frame);
              const trackFrame = {
                selected: (selectedTrackId === track.trackId),
                editing: editingTrack,
                trackId: track.trackId,
                features,
                confidencePairs: track.confidencePairs,
              };
              tracks.push(trackFrame);
              // eslint-disable-next-line max-len
              if (tracks[tracks.length - 1].selected && (props.editingTrack.value || props.featurePointing.value)) {
                editingTracks.push(trackFrame);
              }
            }
          }
        },
      );

      annotationLayer.changeData(tracks);
      textLayer.changeData(tracks);
      markerLayer.changeData(tracks);

      if (props.selectedTrackId.value) {
      // eslint-disable-next-line max-len
        if ((props.editingTrack.value || props.featurePointing.value) && !currentFrameIds.includes(props.selectedTrackId.value)) {
          const editTrack = props.trackMap.get(props.selectedTrackId.value);
          const features = editTrack.getFeature(frameNumber.value);
          const trackFrame = {
            selected: true,
            editing: true,
            trackId: editTrack.trackId.value,
            features,
            confidencePairs: editTrack.confidencePairs.value,
          };
          editingTracks.push(trackFrame);
        }
        // Only update tracks if created and not an annotationChanged
        if (editingTracks.length) {
          if (!updated.annotationChanged && props.editingTrack.value) {
            editAnnotationLayer.changeData(editingTracks);
          }
          if (!updated.annotationChanged && props.featurePointing.value) {
            markerEditLayer.changeData([]);
          }
        } else {
          markerEditLayer.disable();
          editAnnotationLayer.disable();
        }
      }
    }


    updateLayers();
    const names = ['frame', 'ids', 'editing', 'selected', 'featurePointing'];
    watch([
      frameNumber,
      props.trackIds,
      props.editingTrack,
      props.selectedTrackId,
      props.featurePointing,
    ], (values, oldvalues) => {
      // Helper function for me to see what is going on
      // REMOVE AFTERWARDS
      const updated = {};
      for (let i = 0; i < values.length; i += 1) {
        if (!oldvalues) {
          updated[names[i]] = true;
        } else {
          updated[names[i]] = (values[i] !== oldvalues[i]);
        }
      }
      updateLayers(updated);
    });


    const Clicked = (trackId: number, editing: boolean) => {
      if (!props.featurePointing.value) {
        editAnnotationLayer.disable();
        emit('selectTrack', trackId, editing);
      }
    };
    annotationLayer.$on('annotationClicked', Clicked);
    annotationLayer.$on('annotationRightClicked', Clicked);

    editAnnotationLayer.$on('update:geojson', (data) => {
      const track = props.trackMap.get(props.selectedTrackId.value);
      if (track) {
        const bounds = geojsonToBound(data.geometry);
        track.setFeature({
          frame: frameNumber.value,
          bounds,
        });
        // We don't need to update the editing layer unless we create a new annotation
        updateLayers({ annotationChanged: !data.refresh });
      }
    });

    markerEditLayer.$on('update:geojson', (data) => {
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
