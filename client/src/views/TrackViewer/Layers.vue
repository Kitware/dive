<script lang="ts">
import {
  defineComponent,
  computed,
  PropType,
  inject,
  Ref,
  watch,
  ref,
} from '@vue/composition-api';

import { FrameDataTrack } from '@/components/layers/LayerTypes';
// eslint-disable-next-line no-unused-vars
import Track, { TrackId } from '@/lib/track';
import { FeaturePointingTarget } from '@/use/useFeaturePointing';
import IntervalTree from '@flatten-js/interval-tree';


import AnnotationLayer from '@/components/layers/AnnotationLayer';
import TextLayer from '@/components/layers/TextLayer';
import EditAnnotationLayer from '@/components/layers/EditAnnotationLayer';
import MarkerLayer from '@/components/layers/MarkerLayer.vue';
import { geojsonToBound, geojsonToBound2 } from '../../utils';


export default defineComponent({
  props: {
    trackMap: {
      type: Map as PropType<Map<TrackId, Track>>,
      required: true,
    },
    filteredTrackIds: {
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
    const annotator: any = inject('annotator');
    const frameNumber: Readonly<Ref<number>> = computed(() => annotator.frame as number);


    const Clicked = (trackId: number, editing: boolean) => {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      editAnnotationLayer.disable();
      emit('selectTrack', trackId, editing);
    };

    const annotationLayer = new AnnotationLayer({
      annotator,
      stateStyling: props.stateStyling,
      typeColorMap: props.typeColorMapper,
    });
    annotationLayer.$on('annotationClicked', Clicked);
    annotationLayer.$on('annotationRightClicked', Clicked);

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

    function updateLayers() {
      // eslint-disable-next-line max-len
      const currentFrameIds: number[] = props.intervalTree.search([frameNumber.value, frameNumber.value]);
      const tracks: FrameDataTrack[] = [];
      const editingTracks: FrameDataTrack[] = [];
      currentFrameIds.forEach(
        (item: number) => {
          if (props.filteredTrackIds.value.includes(item)) {
            if (props.trackMap.has(item)) {
              const track: Track = props.trackMap.get(item)!;
              const trackFrame = {
                selected: (props.selectedTrackId.value === track.trackId.value),
                editing: props.editingTrack.value,
                trackId: track.trackId.value,
                features: track.getFeature(frameNumber.value),
                confidencePairs: track.confidencePairs.value,
              };
              tracks.push(trackFrame);
              if (tracks[tracks.length - 1].selected && props.editingTrack.value) {
                editingTracks.push(trackFrame);
              }
            }
          }
        },
      );
      annotationLayer.changeData(tracks);
      textLayer.changeData(tracks);
      if (props.editingTrack.value) {
        editAnnotationLayer.changeData(editingTracks);
      } else {
        editAnnotationLayer.disable();
      }
    }

    editAnnotationLayer.$on('update:geojson', (data) => {
      const track = props.trackMap.get(props.selectedTrackId.value);
      if (track) {
        const bounds = data.type !== 'Feature'
          ? geojsonToBound2(data)
          : geojsonToBound(data.geometry);
        track.setFeature({
          frame: frameNumber.value,
          bounds,
        });
        updateLayers();
      }
    });

    updateLayers();
    // Is a referenced data so it can be set manually during updates to the bounds or features
    const editingTrackData: Ref<FrameDataTrack | null> = ref(null);
    watch([
      frameNumber,
      props.editingTrack,
      props.selectedTrackId,
      props.filteredTrackIds,
    ], () => {
      updateLayers();
    });

    function nextFrame() {
      annotator.$emit('next-frame');
    }
    function previousFrame() {
      annotator.$emit('prev-frame');
    }
    function togglePlay() {
      if (annotator.playing) {
        annotator.$emit('pause');
      } else {
        annotator.$emit('play');
      }
    }

    return {
      props,
      previousFrame,
      nextFrame,
      togglePlay,
    };
  },
});
</script>

<template>
  <div
    v-mousetrap="[
      { bind: 'left', handler: previousFrame },
      { bind: 'right', handler: nextFrame },
      { bind: 'space', handler: togglePlay }
    ]"
  >
    <!--
    <edit-annotation-layer
      v-if="featurePointing"
      editing="point"
      @update:geojson="featurePointed"
    />

    <marker-layer
      :data="markerData"
      :styling="stateStyling"
      :color-map="typeColorMapper"
    />
    -->
  </div>
</template>
