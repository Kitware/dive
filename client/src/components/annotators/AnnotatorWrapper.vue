<script lang="ts">
import {
  computed,
  defineComponent, PropType, ref,
} from '@vue/composition-api';
import { DatasetType } from 'dive-common/apispec';
import { useSelectedCamera } from 'vue-media-annotator/provides';
import ImageAnnotator from './ImageAnnotator.vue';
import VideoAnnotator from './VideoAnnotator.vue';
import LayerManager from '../LayerManager.vue';
import { SetTimeFunc } from '../../use/useTimeObserver';
import { MediaControlAggregator, MediaController } from './mediaControllerType';

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
    const selectedCamera = useSelectedCamera();
    const mediaControlAggregator = computed(() => {
      if (subPlaybackComponent.value
      && subPlaybackComponent.value?.length === props.cameras.length) {
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


    const controlHeight = computed(() => {
      if (control.value !== undefined && control.value.children.length) {
        return control.value.children[0].clientHeight;
      }
      return 251;
    });


    return {
      subPlaybackComponent,
      mediaControlAggregator,
      control,
      controlHeight,
      selectedCamera,
    };
  },
});
</script>

<template>
  <v-col
    class="playback-component annotation-wrapper pa-0"
    style="height:100%"
    dense
  >
    <v-row class="fill-height">
      <v-col
        v-for="camera in cameras"
        :key="camera"
        style="padding: 0px; margin:0px;"
        class="fill-height"
        @click="$emit('select-camera', camera)"
      >
        <component
          :is="datasetType === 'image-sequence' ? 'image-annotator' : 'video-annotator'"
          v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
          ref="subPlaybackComponent"
          class="fill-height"
          :class="{'selected-camera': selectedCamera === camera && camera !== 'default'}"
          v-bind="{
            imageData: imageData[camera], videoUrl: videoUrl[camera],
            updateTime, frameRate, originalFps, loadImageFunc, camera }"
        >
          <div
            :style="{'min-height':`${controlHeight}px`}"
          >
            <layer-manager :camera="camera" />
          </div>
        </component>
      </v-col>
    </v-row>
    <span
      ref="control"
    >
      <slot
        name="control"
      />
    </span>
  </v-col>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
