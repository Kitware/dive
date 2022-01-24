<script lang="ts">
import {
  computed,
  defineComponent, onMounted, PropType, Ref, ref,
} from '@vue/composition-api';
import { DatasetType } from 'dive-common/apispec';
import ImageAnnotator from './ImageAnnotator.vue';
import VideoAnnotator from './VideoAnnotator.vue';
import LayerManager from '../LayerManager.vue';
import { SetTimeFunc } from '../../use/useTimeObserver';
import { MediaControlAggregator, MediaController } from './mediaControllerType';
import useMediaController from './useMediaController';

export interface ImageDataItem {
  url: string;
  filename: string;
}


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
    originalFps: {
      type: Number as PropType<number | null>,
      default: null,
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
    progress: {
      type: Object as PropType<{loaded: boolean}>,
      required: true,
    },
  },

  setup(props) {
    const subPlaybackComponent = ref(undefined as Vue[] | undefined);
    const control = ref(undefined as HTMLElement | undefined);
    const mediaControlAggregator = computed(() => {
      if (subPlaybackComponent.value && subPlaybackComponent.value?.length >= 1) {
        // TODO: Bug in composition-api types incorrectly organizes the static members of a Vue
        // instance when using typeof ImageAnnotator, so we can't use the "real" type here
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore

        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        // eslint-disable-next-line max-len
        const controllers: MediaController[] = subPlaybackComponent.value?.map((item) => item.mediaController as MediaController);
        const aggregateController: MediaControlAggregator = {
          maxFrame: controllers[0].maxFrame,
          frame: controllers[0].frame,
          seek: (frame: number) => controllers.forEach((item) => item.seek(frame)),
          volume: controllers[0].volume,
          setVolume: (volume: number) => controllers.forEach((item) => item.setVolume(volume)),
          speed: controllers[0].speed,
          setSpeed: (speed: number) => controllers.forEach((item) => item.setSpeed(speed)),
          lockedCamera: controllers[0].lockedCamera,
          toggleLockedCamera: () => controllers.forEach((item) => item.toggleLockedCamera()),
          pause: () => controllers.forEach((item) => item.pause()),
          play: () => controllers.forEach((item) => item.play()),
          playing: controllers[0].playing,
          nextFrame: () => controllers.forEach((item) => item.nextFrame()),
          prevFrame: () => controllers.forEach((item) => item.prevFrame()),
          resetZoom: () => controllers.forEach((item) => item.resetZoom()),
          // eslint-disable-next-line max-len
          duration: computed(() => controllers.reduce((acc, item) => ({ ...acc, [item.camera.value]: item.duration.value }), {})),
          // eslint-disable-next-line max-len
          currentTime: computed(() => controllers.reduce((acc, item) => ({ ...acc, [item.camera.value]: item.currentTime.value }), {})),
          // eslint-disable-next-line max-len
          filename: computed(() => controllers.reduce((acc, item) => ({ ...acc, [item.camera.value]: item.filename.value }), {})),

        };
        return aggregateController;
      }
      return {} as MediaControlAggregator;
    });

    const onResize = computed(() => {
      if (subPlaybackComponent.value && subPlaybackComponent.value?.length >= 1) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        return (subPlaybackComponent.value[0].onResize as () => void);
      }
      return null;
    });

    const controlHeight = computed(() => {
      if (control.value !== undefined && control.value.children.length) {
        return control.value.children[0].clientHeight;
      }
      return 251;
    });


    return {
      subPlaybackComponent,
      mediaControlAggregator,
      onResize,
      control,
      controlHeight,
    };
  },
});
</script>

<template>
  <v-col
    class="playback-component annotation-wrapper fill-height pa-0"
    dense
  >
    <v-row class="fill-height">
      <v-col
        v-for="camera in cameras"
        :key="camera"
        style="padding: 0px; margin:0px;"
        class="fill-height"
      >
        <component
          :is="datasetType === 'image-sequence' ? 'image-annotator' : 'video-annotator'"
          v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
          ref="subPlaybackComponent"
          class="fill-height"
          v-bind="{
            imageData: imageData[camera], videoUrl: videoUrl[camera],
            updateTime, frameRate, originalFps, loadImageFunc, camera }"
        >
          <layer-manager
            :style="{'min-height':`${controlHeight}px`}"
            :camera="camera"
          />
        </component>
      </v-col>
    </v-row>
    <span
      ref="control"
    >
      <slot
        name="control"
        @resize="onResize"
      />
    </span>
  </v-col>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
