<script lang="ts">
import {
  defineComponent, ref, onUnmounted, PropType, toRef, watch,
} from '@vue/composition-api';
import { DatasetType } from 'dive-common/apispec';
import {
  ImageAnnotator,
  VideoAnnotator,
  LayerManager,
} from 'vue-media-annotator/components';
import { SetTimeFunc } from '../use/useTimeObserver';
import { ImageDataItem } from './annotators/ImageAnnotator.vue';

function loadImageFunc(imageDataItem: ImageDataItem, img: HTMLImageElement) {
  // eslint-disable-next-line no-param-reassign
  img.src = imageDataItem.url;
}


export default defineComponent({
  name: 'AnnotationWrapper',
  components: {
    VideoAnnotator,
    ImageAnnotator,
    LayerManager,
  },
  props: {
    datasetType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
    cameras: {
      type: Array as PropType<string[]>,
      required: true,
    },
    currentCamera: {
      type: String,
      required: true,
    },
    imageData: {
      type: Object as PropType<Record<string, ImageDataItem[]>>,
      required: true,
    },
    videoUrl: {
      type: Object as PropType<Record<string, string>>,
      required: true,
    },
    videoPlayerAttributes: {
      type: Object as PropType<{ [key: string]: string }>,
      default: () => ({}),
    },
    frameRate: {
      type: Number,
      required: true,
    },
    updateTime: {
      type: Function as PropType<SetTimeFunc>,
      required: true,
    },
    loadImageFunc: {
      type: Function as PropType<(imageDataItem: ImageDataItem, img: HTMLImageElement) => void>,
      default: loadImageFunc,
    },
    // Range is [0, inf.)
    brightness: {
      type: Number as PropType<number | undefined>,
      default: undefined,
    },
  },

  setup(props) {
    // We
    return {

    };
  },
});
</script>

<template>
  <div>
    <v-row>
      <div
        v-for="camera in cameras"
        :key="camera"
      >
        <component
          :is="datasetType === 'image-sequence' ? 'image-annotator' : 'video-annotator'"
          v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
          ref="playbackComponent"
          v-bind="{
            imageData: imageData[camera], videoUrl: videoUrl[camera],
            updateTime, frameRate, originalFps, loadImageFunc }"
          class="playback-component"
        />
        <layer-manager :camera="camera" />
      </div>
      <slot
        ref="control"
        name="control"
        @resize="onResize"
      />
      <slot />
    </v-row>
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
