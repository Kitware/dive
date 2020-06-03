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
import { geojsonToBound, geojsonToBound2 } from '@/utils';
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

    const markerLayer = new MarkerLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeColorMap: props.typeColorMapper,
    });

    function updateLayers(updated = {}) {
      console.log(updated);
      const currentFrameIds = props.intervalTree.search([frameNumber.value, frameNumber.value]);
      const tracks = [] as FrameDataTrack[];
      const editingTracks = [] as FrameDataTrack[];
      currentFrameIds.forEach(
        (item: number) => {
          if (props.trackIds.value.includes(item)) {
            if (props.trackMap.has(item)) {
              const track = props.trackMap.get(item);
              if (track === undefined) {
                throw new Error(`trackMap missing trackid ${item}`);
              }
              const features = track.getFeature(frameNumber.value);
              const trackFrame = {
                selected: (props.selectedTrackId.value === track.trackId.value),
                editing: props.editingTrack.value,
                trackId: track.trackId.value,
                features,
                confidencePairs: track.confidencePairs.value,
              };
              if (features) {
                tracks.push(trackFrame);
                // eslint-disable-next-line max-len
                if ((tracks[tracks.length - 1].selected && props.editingTrack.value)) {
                  editingTracks.push(trackFrame);
                }
              }
            }
          }
        },
      );

      if (props.editingTrack.value && !currentFrameIds.includes(props.selectedTrackId.value)) {
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

      annotationLayer.changeData(tracks);
      textLayer.changeData(tracks);
      markerLayer.changeData(tracks);
      if (editingTracks.length) {
        if (!updated.annotationChanged) {
          console.log('changeData in editingTracks');
          console.log(editingTracks);
          editAnnotationLayer.changeData(editingTracks);
        }
      } else {
        editAnnotationLayer.disable();
      }
    }


    updateLayers();
    const names = ['frame', 'ids', 'editing', 'selected'];
    watch([
      frameNumber,
      props.trackIds,
      props.editingTrack,
      props.selectedTrackId,
    ], (values, oldvalues) => {
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
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      editAnnotationLayer.disable();
      emit('selectTrack', trackId, editing);
    };
    annotationLayer.$on('annotationClicked', Clicked);
    annotationLayer.$on('annotationRightClicked', Clicked);

    editAnnotationLayer.$on('update:geojson', (data) => {
      const track = props.trackMap.get(props.selectedTrackId.value);
      if (track) {
        const bounds = data.type !== 'Feature'
          ? geojsonToBound2(data.geometry)
          : geojsonToBound(data.geometry);
        track.setFeature({
          frame: frameNumber.value,
          bounds,
        });
        // We don't need to update the editing layer unless we create a new annotation
        updateLayers({ annotationChanged: !data.refresh });
      }
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
