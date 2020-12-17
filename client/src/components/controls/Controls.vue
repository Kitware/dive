<script lang="ts">
import { defineComponent, reactive, watch } from '@vue/composition-api';
import { injectMediaController } from '../annotators/useMediaController';

export default defineComponent({
  name: 'Control',

  setup() {
    const data = reactive({
      frame: 0,
      dragging: false,
    });

    const mediaController = injectMediaController();

    watch(mediaController.frame, (frame) => {
      if (!data.dragging) {
        data.frame = frame;
      }
    });

    const dragHandler = {
      start() { data.dragging = true; },
      end() { data.dragging = false; },
    };

    function input(value: number) {
      if (mediaController.frame.value !== value) {
        mediaController.seek(value);
      }
      data.frame = value;
    }

    function togglePlay() {
      if (mediaController.playing.value) {
        mediaController.pause();
      } else {
        mediaController.play();
      }
    }

    return {
      data,
      mediaController,
      dragHandler,
      input,
      togglePlay,
    };
  },
});
</script>

<template>
  <div
    v-mousetrap="[
      { bind: 'left', handler: mediaController.prevFrame, disabled: $prompt.visible() },
      { bind: 'right', handler: mediaController.nextFrame, disabled: $prompt.visible()},
      { bind: 'space', handler: togglePlay, disabled: $prompt.visible() },
      { bind: 'f', handler: mediaController.nextFrame, disabled: $prompt.visible() },
      { bind: 'd', handler: mediaController.prevFrame, disabled: $prompt.visible() },
    ]"
  >
    <v-toolbar
      height="80px"
      flat
    >
      <v-container
        fluid
        class="pa-0"
      >
        <v-row>
          <v-slider
            hide-details
            :min="0"
            :max="mediaController.maxFrame.value"
            :value="data.frame"
            @start="dragHandler.start"
            @end="dragHandler.end"
            @input="input"
          />
        </v-row>
        <v-row
          align-content="space-between"
          dense
        >
          <v-col class="pl-1 py-1">
            <slot
              justify="start"
              name="timelineControls"
            />
          </v-col>
          <v-col
            align="center"
            class="py-1 shrink"
            style="min-width: 100px;"
          >
            <v-btn
              icon
              small
              title="(d, left-arrow) previous frame"
              @click="mediaController.prevFrame"
            >
              <v-icon>mdi-skip-previous</v-icon>
            </v-btn>
            <v-btn
              v-if="!mediaController.playing.value"
              icon
              small
              title="(space) Play"
              @click="mediaController.play"
            >
              <v-icon>mdi-play</v-icon>
            </v-btn>
            <v-btn
              v-else
              icon
              small
              title="(space) Pause"
              @click="mediaController.pause"
            >
              <v-icon>mdi-pause</v-icon>
            </v-btn>
            <v-btn
              icon
              small
              title="(f, right-arrow) next frame"
              @click="mediaController.nextFrame"
            >
              <v-icon>mdi-skip-next</v-icon>
            </v-btn>
          </v-col>
          <v-col
            class="pl-1 py-1"
            align="right"
          >
            <v-btn
              icon
              small
              title="(r)eset pan and zoom"
              @click="mediaController.resetZoom"
            >
              <v-icon>mdi-image-filter-center-focus</v-icon>
            </v-btn>
          </v-col>
        </v-row>
      </v-container>
    </v-toolbar>
  </div>
</template>
