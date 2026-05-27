<script lang="ts">
import {
  defineComponent, ref, onMounted, onBeforeUnmount, PropType,
} from 'vue';
import { resizeCanvas } from 'vue-media-annotator/sam2/imageUtils';
import type Sam3Tracker from 'vue-media-annotator/sam2/sam3TrackerModel';

const SAM_IMAGE_SIZE = { w: 1024, h: 1024 };

/**
 * SAM3 tracker (Transformers.js + WebGPU), same stack as SAM3-Tracker-WebGPU.
 * Runs in the renderer main thread so `device: "webgpu"` can use the window GPU context.
 */
export default defineComponent({
  name: 'Sam2EmbedPanel',
  props: {
    captureFrame: {
      type: Function as PropType<() => HTMLCanvasElement | null | Promise<HTMLCanvasElement | null>>,
      required: true,
    },
  },
  setup(props) {
    const modelLoading = ref(false);
    const modelLoadPercent = ref(0);
    const modelLoadStatus = ref('');
    const modelError = ref('');
    const device = ref<string | null>(null);
    const modelReady = ref(false);

    const captureBusy = ref(false);
    const embedBusy = ref(false);
    const capturedCanvas = ref<HTMLCanvasElement | null>(null);
    const embedDoneMs = ref<number | null>(null);
    const webGpuHint = ref('');

    let tracker: Sam3Tracker | null = null;

    function deviceLabel(ep: string | null) {
      if (!ep) return '';
      if (ep === 'webgpu') return 'GPU (WebGPU)';
      if (ep === 'wasm') return 'CPU (WASM)';
      return ep;
    }

    async function loadSam3Model() {
      if (modelReady.value) return;
      modelLoading.value = true;
      modelLoadPercent.value = 0;
      modelLoadStatus.value = 'Starting…';
      modelError.value = '';
      try {
        if (!tracker) {
          const { default: Sam3TrackerCtor } = await import('vue-media-annotator/sam2/sam3TrackerModel');
          tracker = new Sam3TrackerCtor();
          const report = await tracker.load((update) => {
            modelLoadPercent.value = update.percent;
            if (update.statusText) {
              modelLoadStatus.value = update.statusText;
            }
          });
          if (!report.success) {
            tracker = null;
            modelError.value = report.webGpuUnavailableReason
              || 'SAM3 failed to initialize. Check the browser console (network / WASM).';
            device.value = null;
            webGpuHint.value = '';
          } else {
            device.value = report.device;
            webGpuHint.value = report.webGpuUnavailableReason || '';
            modelReady.value = true;
          }
        }
      } catch (e) {
        tracker = null;
        modelError.value = (e as Error).message || 'Failed to load SAM3';
      } finally {
        modelLoading.value = false;
        modelLoadPercent.value = 0;
        modelLoadStatus.value = '';
      }
    }

    onMounted(() => {
      embedDoneMs.value = null;
      capturedCanvas.value = null;
      modelError.value = '';
      loadSam3Model();
    });

    onBeforeUnmount(() => {
      tracker = null;
      modelReady.value = false;
      device.value = null;
      webGpuHint.value = '';
      capturedCanvas.value = null;
      embedDoneMs.value = null;
    });

    async function onCaptureFrame() {
      captureBusy.value = true;
      modelError.value = '';
      embedDoneMs.value = null;
      try {
        const canvas = await Promise.resolve(props.captureFrame());
        if (canvas) {
          capturedCanvas.value = canvas;
        } else {
          capturedCanvas.value = null;
          modelError.value = 'Could not capture the current frame. Try again after the image or video has fully loaded.';
        }
      } finally {
        captureBusy.value = false;
      }
    }

    async function onEmbedImage() {
      if (!tracker || !modelReady.value || !capturedCanvas.value) return;
      embedBusy.value = true;
      modelError.value = '';
      try {
        const resized = resizeCanvas(capturedCanvas.value, SAM_IMAGE_SIZE);
        const t0 = performance.now();
        await tracker.encodeImageFromCanvas(resized);
        embedDoneMs.value = performance.now() - t0;
      } catch (e) {
        modelError.value = (e as Error).message || 'Embedding failed';
      } finally {
        embedBusy.value = false;
      }
    }

    return {
      modelLoading,
      modelLoadPercent,
      modelLoadStatus,
      modelError,
      device,
      modelReady,
      deviceLabel,
      captureBusy,
      embedBusy,
      capturedCanvas,
      embedDoneMs,
      webGpuHint,
      onCaptureFrame,
      onEmbedImage,
    };
  },
});
</script>

<template>
  <div class="sam2-embed-inline d-flex align-center flex-wrap flex-grow-1 mx-1">
    <v-progress-circular
      v-if="modelLoading"
      :indeterminate="modelLoadPercent === 0"
      :value="modelLoadPercent"
      size="44"
      width="4"
      color="light-blue"
      rotate="-90"
      class="mr-2 sam3-load-progress"
      :title="modelLoadStatus"
    >
      <span
        v-if="modelLoadPercent === 0"
        class="sam3-load-pct sam3-load-pct--small"
      >…</span>
      <span
        v-else
        class="sam3-load-pct"
      >{{ modelLoadPercent }}%</span>
    </v-progress-circular>
    <span
      v-else-if="modelReady && device"
      class="text-caption grey--text text--lighten-1 mr-2"
      :title="webGpuHint || undefined"
    >
      {{ deviceLabel(device) }}
    </span>

    <v-alert
      v-if="modelError"
      dense
      text
      type="error"
      class="ma-0 py-0 px-2 mr-2"
      style="max-width: 360px;"
    >
      {{ modelError }}
    </v-alert>

    <v-btn
      class="mr-1"
      small
      outlined
      color="amber"
      :disabled="!modelReady || modelLoading"
      :loading="captureBusy"
      @click="onCaptureFrame"
    >
      <v-icon
        left
        small
      >
        mdi-auto-fix
      </v-icon>
      Capture frame
    </v-btn>

    <v-btn
      class="mr-1"
      small
      color="primary"
      :disabled="!modelReady || !capturedCanvas || embedBusy"
      :loading="embedBusy"
      @click="onEmbedImage"
    >
      <v-icon
        left
        small
        :class="{ 'mdi-spin': embedBusy }"
      >
        {{ embedBusy ? 'mdi-loading' : 'mdi-vector-polygon' }}
      </v-icon>
      Embed image
    </v-btn>

    <span
      v-if="embedDoneMs != null"
      class="text-caption success--text"
    >
      Embedded in {{ embedDoneMs.toFixed(0) }} ms
    </span>
  </div>
</template>

<style scoped>
.sam2-embed-inline {
  min-height: 36px;
}

.sam3-load-progress {
  flex-shrink: 0;
}

.sam3-load-pct {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: rgba(255, 255, 255, 0.9);
}

.sam3-load-pct--small {
  font-size: 14px;
}
</style>
