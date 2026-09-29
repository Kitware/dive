<script lang="ts">
import {
  defineComponent,
  reactive,
  PropType,
  ref,
  computed,
  onMounted,
} from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import { stereoMatchMethodsFor } from 'dive-common/use/stereo/stereoMatcher';
import { samHardwareGpuAvailable } from 'dive-common/use/segmentation/SamOnnx';
import isDesktopRuntime from 'dive-common/isDesktopRuntime';

export default defineComponent({
  name: 'TrackSettingsPanel',

  props: {
    allTypes: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
    isStereoDataset: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
    const help = reactive({
      mode: {
        Track: 'Track mode: advance a frame while drawing to build a track across frames.',
        Detection: 'Detection mode: create multiple detections on a single frame.',
      },
      type: 'Default type for new tracks/detections. Type a new name to add it.',
      autoAdvanceFrame: 'After creating a track, advance to the next frame. Hit Esc to exit.',
      interpolate: 'New tracks have interpolation enabled by default.',
      continuous: 'Stay in detection creation mode after creating a detection. Hit Esc to exit.',
      prompt: 'Ask for confirmation before deleting a track.',
      segmentationModel: 'Downloads once on first use and runs in your browser. Tiny is the fastest. Small produces more accurate masks, but its image embedding takes roughly twice as long and needs more GPU memory.',
      segmentationDevice: 'Each new frame is embedded once: under a second on GPU, typically 5–15 seconds on CPU (10–30× slower). Later clicks on the same frame are quick. Auto prefers the GPU and falls back to CPU.',
      autoPopulateMask: 'After drawing a new box or head/tail line, run the segmentation model on it (the drawn box, or points along the line) and store the resulting polygon on the detection.',
      autoPopulatePoints: 'After drawing a new box, derive head/tail points from its segmentation the way the VIAME keypoint pipelines do. After drawing a new line, tighten the box to the segmentation.',
      filterTracksByFrame: 'Only list tracks that have a detection on the current frame.',
      showMultiCamToolbar: 'Show multi-camera tools in the top toolbar when a track is selected.',
      stereoUpdateLengths: 'When a line annotation is modified on a detection that is linked across both cameras, recompute its stereo measurement (length, midpoint, range, RMS) automatically.',
      stereoAutoCompute: 'When an annotation is drawn on one camera and the other camera has no detection for it yet, automatically warp it to the other camera using stereo disparity.',
      stereoMatchMethod: isDesktopRuntime()
        ? 'How points are located on the other camera. "Higher Quality, Slower" runs the Fast Foundation Stereo model over the whole image pair and reads every point from its disparity map, which is computed ahead of time whenever you change frames (requires the Fast Foundation Stereo add-on). "Medium Quality, Medium Speed" template-matches each point along its epipolar line after DINO features pick the candidates (requires the DINO add-on). "Lower Quality, Faster" template-matches each point along its epipolar line.'
        : 'How points are located on the other camera. "Higher Quality, Slower" runs the Fast Foundation Stereo model over the whole image pair (downloaded once, about 90 MB; needs a WebGPU-capable browser) and reads every point from its disparity map, which is computed ahead of time whenever you change frames. "Lower Quality, Faster" template-matches each point along its epipolar line.',
    });
    const modes = ref(['Track', 'Detection']);
    // Add unknown as the default type to the typeList
    const typeList = computed(() => ['unknown'].concat(props.allTypes));
    const samGpuChecked = ref(false);
    const samGpuAvailable = ref(false);
    const segmentationDevices = computed(() => (samGpuAvailable.value
      ? [
        { text: 'Auto (GPU preferred)', value: 'auto' },
        { text: 'GPU', value: 'gpu' },
        { text: 'CPU (10–30× slower embedding)', value: 'cpu' },
      ]
      : [
        { text: 'Auto (CPU)', value: 'auto' },
        { text: 'CPU (10–30× slower embedding)', value: 'cpu' },
      ]));

    onMounted(async () => {
      if (isDesktopRuntime()) return;
      samGpuAvailable.value = await samHardwareGpuAvailable();
      samGpuChecked.value = true;
      // A forced GPU preference is meaningless without a hardware adapter.
      if (!samGpuAvailable.value
        && clientSettings.trackSettings.newTrackSettings.segmentationDevice === 'gpu') {
        clientSettings.trackSettings.newTrackSettings.segmentationDevice = 'auto';
      }
    });

    return {
      clientSettings,
      isDesktopRuntime: isDesktopRuntime(),
      help,
      modes,
      typeList,
      stereoMatchMethods: stereoMatchMethodsFor(isDesktopRuntime()),
      segmentationDevices,
      samGpuChecked,
      samGpuAvailable,
    };
  },
});
</script>

<template>
  <div class="TrackSettings">
    <section class="mb-6">
      <div class="text-subtitle-1 font-weight-medium mb-3">
        New Tracks &amp; Deletion
      </div>
      <v-row dense>
        <v-col
          cols="12"
          sm="6"
        >
          <v-select
            v-model="clientSettings.trackSettings.newTrackSettings.mode"
            :items="modes"
            label="Mode"
            :hint="help.mode[clientSettings.trackSettings.newTrackSettings.mode]"
            persistent-hint
            outlined
            dense
          />
        </v-col>
        <v-col
          cols="12"
          sm="6"
        >
          <v-combobox
            v-model="clientSettings.trackSettings.newTrackSettings.type"
            :items="typeList"
            label="Default type"
            :hint="help.type"
            persistent-hint
            outlined
            dense
          />
        </v-col>
      </v-row>
      <template v-if="clientSettings.trackSettings.newTrackSettings.mode === 'Track'">
        <v-switch
          v-model="clientSettings.trackSettings.newTrackSettings.modeSettings.Track.autoAdvanceFrame"
          label="Advance frame"
          :hint="help.autoAdvanceFrame"
          persistent-hint
          dense
          class="mt-3"
        />
        <v-switch
          v-model="clientSettings.trackSettings.newTrackSettings.modeSettings.Track.interpolate"
          label="Interpolate"
          :hint="help.interpolate"
          persistent-hint
          dense
          class="mt-3"
        />
      </template>
      <v-switch
        v-if="clientSettings.trackSettings.newTrackSettings.mode === 'Detection'"
        v-model="clientSettings.trackSettings.newTrackSettings.modeSettings.Detection.continuous"
        label="Continuous"
        :hint="help.continuous"
        persistent-hint
        dense
        class="mt-3"
      />
      <v-switch
        v-model="clientSettings.trackSettings.deletionSettings.promptUser"
        label="Prompt before deleting"
        :hint="help.prompt"
        persistent-hint
        dense
        class="mt-3"
      />
    </section>

    <v-divider class="mb-4" />
    <section class="mb-6">
      <div class="text-subtitle-1 font-weight-medium mb-3">
        Segmentation
      </div>
      <template v-if="!isDesktopRuntime">
        <v-alert
          v-if="samGpuChecked && !samGpuAvailable"
          type="warning"
          dense
          text
          class="mb-4"
        >
          No hardware GPU adapter was detected in this browser, so segmentation
          will run on the CPU. Expect roughly 5–15 seconds or more to embed each
          new frame.
        </v-alert>
        <v-select
          v-model="clientSettings.trackSettings.newTrackSettings.segmentationModel"
          :items="[{ text: 'SAM2.1 Tiny', value: 'sam2' }, { text: 'SAM2.1 Small', value: 'sam2-small' }]"
          label="Segmentation model"
          :hint="help.segmentationModel"
          persistent-hint
          outlined
          dense
        />
        <v-select
          v-model="clientSettings.trackSettings.newTrackSettings.segmentationDevice"
          :items="segmentationDevices"
          label="Segmentation device"
          :hint="help.segmentationDevice"
          persistent-hint
          outlined
          dense
          class="mt-4"
        />
      </template>
      <v-switch
        v-model="clientSettings.trackSettings.newTrackSettings.autoPopulateMask"
        label="Auto-populate mask"
        :hint="help.autoPopulateMask"
        persistent-hint
        dense
        class="mt-3"
      />
      <v-switch
        v-model="clientSettings.trackSettings.newTrackSettings.autoPopulatePoints"
        label="Auto-populate points"
        :hint="help.autoPopulatePoints"
        persistent-hint
        dense
        class="mt-3"
      />
    </section>

    <v-divider class="mb-4" />
    <section class="mb-6">
      <div class="text-subtitle-1 font-weight-medium mb-3">
        Track List
      </div>
      <v-switch
        v-model="clientSettings.trackSettings.trackListSettings.filterDetectionsByFrame"
        label="Filter detections by frame"
        :hint="help.filterTracksByFrame"
        persistent-hint
        dense
        class="mt-0"
      />
    </section>

    <v-divider class="mb-4" />
    <section :class="{ 'mb-6': isStereoDataset }">
      <div class="text-subtitle-1 font-weight-medium mb-3">
        Multi Camera
      </div>
      <v-switch
        v-model="clientSettings.multiCamSettings.showToolbar"
        label="Show toolbar"
        :hint="help.showMultiCamToolbar"
        persistent-hint
        dense
        class="mt-0"
      />
    </section>

    <template v-if="isStereoDataset">
      <v-divider class="mb-4" />
      <section>
        <div class="text-subtitle-1 font-weight-medium mb-3">
          Stereo
        </div>
        <v-switch
          v-model="clientSettings.stereoSettings.updateLengthsOnModify"
          label="Update lengths when modified"
          :hint="help.stereoUpdateLengths"
          persistent-hint
          dense
          class="mt-0"
        />
        <v-switch
          v-model="clientSettings.stereoSettings.autoComputeOtherCamera"
          label="Auto-compute location on other camera"
          :hint="help.stereoAutoCompute"
          persistent-hint
          dense
          class="mt-3"
        />
        <v-select
          v-model="clientSettings.stereoSettings.matchMethod"
          :items="stereoMatchMethods"
          label="Stereo point matching"
          :hint="help.stereoMatchMethod"
          persistent-hint
          outlined
          dense
          class="mt-6"
        />
      </section>
    </template>
  </div>
</template>
