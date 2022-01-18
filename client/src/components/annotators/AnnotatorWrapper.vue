<script lang="ts">
import {
  computed,
  defineComponent, onMounted, PropType, ref,
} from '@vue/composition-api';
import { DatasetType } from 'dive-common/apispec';
import ImageAnnotator from './ImageAnnotator.vue';
import VideoAnnotator from './VideoAnnotator.vue';
import LayerManager from '../LayerManager.vue';
import { SetTimeFunc } from '../../use/useTimeObserver';
import { MediaController } from './mediaControllerType';

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
    // We
    console.log(props.imageData);
    console.log(props.cameras);
    const subPlaybackComponent = ref(undefined as Vue[] | undefined);
    const mediaController = computed(() => {
      if (subPlaybackComponent.value) {
        if (subPlaybackComponent.value?.length >= 1) {
          console.log(subPlaybackComponent.value);
          // TODO: Bug in composition-api types incorrectly organizes the static members of a Vue
          // instance when using typeof ImageAnnotator, so we can't use the "real" type here
          // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
          // @ts-ignore

        //In this case we need to collate all sub mediaControllers into one
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        return subPlaybackComponent.value[0].mediaController as MediaController;
      }
      return {} as MediaController;
    });


    return {
      subPlaybackComponent,
      mediaController,
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
        <div
          v-if="(imageData[camera].length || videoUrl[camera]) && progress.loaded"
        >
          <component
            :is="datasetType === 'image-sequence' ? 'image-annotator' : 'video-annotator'"
            ref="subPlaybackComponent"
            v-bind="{
              imageData: imageData[camera], videoUrl: videoUrl[camera],
              updateTime, frameRate, originalFps, loadImageFunc, camera }"
            class="playback-component"
          >
            <layer-manager
              :camera="camera"
            />
            <slot
              v-if="mediaController.frame"
              ref="control"
              name="control"
              @resize="onResize"
            />
          </component>
        </div>
      </div>
    </v-row>
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
