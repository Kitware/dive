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
import EditAnnotationLayer from '@/components/layers/EditAnnotationLayer.vue';
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

    function updateLayers() {
      // eslint-disable-next-line max-len
      const currentFrameIds: number[] = props.intervalTree.search([frameNumber.value, frameNumber.value]);
      const tracks: FrameDataTrack[] = [];
      currentFrameIds.forEach(
        (item: number) => {
          if (props.filteredTrackIds.value.includes(item)) {
            if (props.trackMap.has(item)) {
              const track: Track = props.trackMap.get(item)!;
              tracks.push({
                selected: (props.selectedTrackId.value === track.trackId.value),
                editing: props.editingTrack.value,
                trackId: track.trackId.value,
                features: track.getFeature(frameNumber.value),
                confidencePairs: track.confidencePairs.value,
              });
            }
          }
        },
      );
      annotationLayer.changeData(tracks);
      textLayer.changeData(tracks);
    }
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

    /*
    function createEditingTrackData() {
      if (!props.editingTrack.value) {
        return null;
      }
      const track: Track | undefined = props.trackMap.get(props.selectedTrackId.value);
      if (track) {
        return {
          trackId: props.selectedTrackId.value,
          features: track.features[frameNumber.value],
          confidencePairs: track.confidencePairs.value,
        } as FrameDataTrack;
      }
      return null;
    }

    // Update the editingTrackData value if the selected track, editingTrack or frameNumber changes
    watch([props.editingTrack, props.selectedTrackId, frameNumber],
      (editingTrack, selectedTrackId) => {
        if (editingTrack && selectedTrackId) {
          editingTrackData.value = createEditingTrackData();
        }
      });

    function createFrameData(frameIds: readonly string[]) {
      const tracks: FrameDataTrack[] = [];
      frameIds.forEach(
        (item: string) => {
          if (props.filteredTrackIds.value.includes(item)) {
            if (props.trackMap.has(item)) {
              const track: Track = props.trackMap.get(item)!;
              let features = track.features[frameNumber.value];
              // If we are editing we only need the current Frames edited features
              // this prevents us from having to grab reactivity from elsewhere
              const selected = (props.selectedTrackId.value === track.trackId.value);
              if (props.editingTrack.value && selected && editingTrackData.value) {
                features = track.features[frameNumber.value];
              }
              tracks.push({
                selected,
                editing: props.editingTrack.value,
                trackId: track.trackId.value,
                features,
                confidencePairs: track.confidencePairs.value,
              });
            }
          }
        },
      );
      return tracks;
    }

    //const currentFrameDataTracks = ref(null);

    function updateFrameDataTracks() {
      return createFrameData(currentFrameIds.value);
    }

    watch(frameNumber, () => {
      baseLayer.changeData(createFrameData(currentFrameIds.value));
    });

    // Provides the filtered track data for the currentFrame for all Layers

    const currentFrameDataTracks = computed(() => updateFrameDataTracks());


    function annotationClicked(data: string, editing = false) {
      if (props.editingTrack && editing) {
        editingTrackData.value = null;
      }
      emit('selectTrack', data, editing);
    }

    /**
     * Handles Left/Right click for annotations and sets the selectedTrackId and if
     * editingTrack is true
     * @param {string} data - trackId for the selected annotation
     * @param {boolean} editing - if the selected track should be edited or not
     */
    /*
    function detectionChanged(data: any) {
      // We want the selectedTrackId, for brand new Detections
      const track = props.trackMap.get(props.selectedTrackId.value);
      if (track) {
        const bounds = data.type === 'Feature'
          ? geojsonToBound2(data.geometry)
          : geojsonToBound(data);
        track.setFeature({
          frame: frameNumber.value,
          bounds,
        });
        // TODO p1: figure out the best way to update tracks and intervals when adding new frames
        // don't know if this should be done useTrackStore or somewehere else
        if (!currentFrameIds.value.includes(track.trackId.value)) {
          const min = Math.min(track.begin.value, frameNumber.value);
          const max = Math.max(track.end.value, frameNumber.value);
          props.intervalTree.insert([min, max], track.trackId.value);
        }
        editingTrackData.value = createEditingTrackData();
      }
    }
*/
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

    /*  BELOW ITEMS ARE SAVED IF WE WANT TO DO THE COMPUTATION HERE INSTEAD OF IN THE COMPONENT

    // ------------ AnotationLayer Data --------------- //
    const annotationData = computed(() => {
      const arr:AnnotationGeoJSON[] = [];
      currentFrameDataTracks.value.forEach((track) => {
        const polygon = boundToGeojson(track.features.bounds);
        const coords = polygon.coordinates[0];
        arr.push({
          selected: track.selected,
          editing: track.editing,
          confidencePairs: track.confidencePairs,
          geometry: {
            outer: [
              { x: coords[0][0], y: coords[0][1] },
              { x: coords[1][0], y: coords[1][1] },
              { x: coords[2][0], y: coords[2][1] },
              { x: coords[3][0], y: coords[3][1] },
            ],
          },
        });
      });
      return arr;
    });

    // I HAVEN'T DECIDED YET IF I WANT THIS HERE OR INSIDE EACH COMPONENT YET
    // THAT WILL BE BASED ON IF WE

    // ------------ TextLayer Data --------------- //
    const textData = computed(() => {
      const arr:TextGeoJSON[] = [];
      currentFrameDataTracks.value.forEach((track) => {
        if (track.confidencePairs) {
          const { bounds } = track.features;
          if (bounds) {
            track.confidencePairs.forEach(([type, confidence], i) => {
              arr.push({
                selected: track.selected,
                editing: track.editing,
                text: `${type}: ${confidence.toFixed(2)}`,
                x: bounds![1],
                y: bounds![2],
                offsetY: i * 14,
              });
            });
          }
        }
      });
      return arr;
    });

    // ------------ Marker Data --------------- //
    const markerData = computed(() => {
      const arr:MarkerGeoJSON[] = [];
      currentFrameDataTracks.value.forEach((track) => {
        const feature = track.features;
        if (feature.head) {
          arr.push({
            selected: track.selected,
            editing: track.editing,
            feature: 'head',
            x: feature.head[0],
            y: feature.head[1],
          });
        }
        if (feature.tail) {
          arr.push({
            selected: track.selected,
            editing: track.editing,
            feature: 'tail',
            x: feature.tail[0],
            y: feature.tail[1],
          });
        }
      });
      return arr;
    });
    */
    return {
      // currentFrameDataTracks,
      editingTrackData,
      props,
      // annotationClicked,
      previousFrame,
      nextFrame,
      togglePlay,
      frameNumber,
      // detectionChanged,
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
    <!-- <annotation-layer
      :data="currentFrameDataTracks"
      :state-styling="stateStyling"
      :type-color-map="typeColorMapper"
      @annotation-click="annotationClicked"
      @annotation-right-click="annotationClicked"
    />
    <text-layer
      :data="currentFrameDataTracks"
      :state-styling="stateStyling"
      :type-color-map="typeColorMapper"
    />
    <edit-annotation-layer
      v-if="props.editingTrack.value"
      ref="annotationRectEditor"
      :data="editingTrackData"
      :state-styling="stateStyling"
      :type-color-map="typeColorMapper"
      editing="rectangle"
      @update:geojson="detectionChanged"
    />
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
