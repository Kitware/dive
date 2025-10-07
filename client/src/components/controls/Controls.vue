<script lang="ts">
import {
  defineComponent, reactive, watch, ref,
} from 'vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import context from 'dive-common/store/context';
import { clientSettings } from 'dive-common/store/settings';
import { injectAggregateController } from '../annotators/useMediaController';

export default defineComponent({
  name: 'Controls',
  props: {
    isDefaultImage: {
      type: Boolean as () => boolean,
      required: true,
    },
  },
  setup() {
    const data = reactive({
      frame: 0,
      dragging: false,
    });
    const mediaController = injectAggregateController().value;
    const { visible } = usePrompt();
    const activeLockedCamera = ref(false);
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
    function togglePlay(_: HTMLElement, keyEvent: KeyboardEvent) {
      // Prevent scroll from spacebar and other default effects.
      keyEvent.preventDefault();
      if (mediaController.playing.value) {
        mediaController.pause();
      } else {
        mediaController.play();
      }
    }
    function toggleEnhancements() {
      context.toggle('ImageEnhancements');
    }
    const transitionVal = ref(!!clientSettings.annotatorPreferences.lockedCamera.transition);
    const multBoundsVal = ref(!!clientSettings.annotatorPreferences.lockedCamera.multiBounds);
    watch(() => clientSettings, () => {
      transitionVal.value = !!clientSettings.annotatorPreferences.lockedCamera.transition;
      multBoundsVal.value = !!clientSettings.annotatorPreferences.lockedCamera.multiBounds;
    }, { deep: true, immediate: true });

    return {
      activeLockedCamera,
      data,
      mediaController,
      dragHandler,
      input,
      togglePlay,
      toggleEnhancements,
      visible,
      clientSettings,
      transitionVal,
      multBoundsVal,
    };
  },
});
</script>

<template>
  <div
    v-mousetrap="[
      { bind: 'left', handler: mediaController.prevFrame, disabled: visible() },
      { bind: 'right', handler: mediaController.nextFrame, disabled: visible() },
      { bind: 'space', handler: togglePlay, disabled: visible() },
      { bind: 'f', handler: mediaController.nextFrame, disabled: visible() },
      { bind: 'd', handler: mediaController.prevFrame, disabled: visible() },
      {
        bind: 'l',
        handler: () => mediaController.toggleSynchronizeCameras(!mediaController.cameraSync.value),
        disabled: visible(),
      },
    ]"
  >
    <v-card
      class="px-4 py-1"
      tile
    >
      <v-slider
        hide-details
        :min="0"
        :max="mediaController.maxFrame.value"
        :value="data.frame"
        @start="dragHandler.start"
        @end="dragHandler.end"
        @input="input"
      />
      <v-row no-gutters>
        <v-col class="pl-1 py-1 shrink">
          <slot
            justify="start"
            name="timelineControls"
          />
        </v-col>
        <v-col
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
        >
          <slot name="middle" />
        </v-col>
        <v-col
          class="pl-1 py-1 shrink d-flex"
          align="right"
        >
          <v-menu
            v-model="activeLockedCamera"
            :nudge-left="28"
            left
            top
            :close-on-content-click="false"
            open-on-hover
            open-delay="750"
            close-delay="500"
          >
            <template #activator="{ on, attrs }">
              <v-btn
                icon
                small
                :color="clientSettings.annotatorPreferences.lockedCamera.enabled ? 'primary' : 'default'"
                title="center camera on selected track"
                v-bind="attrs"
                v-on="on"
                @click="clientSettings.annotatorPreferences.lockedCamera.enabled = !clientSettings.annotatorPreferences.lockedCamera.enabled"
              >
                <v-icon>
                  {{ clientSettings.annotatorPreferences.lockedCamera.enabled ? 'mdi-lock-check' : 'mdi-lock-open' }}
                </v-icon>
              </v-btn>
            </template>
            <v-card
              outlined
              class="pa-2 pr-4"
              color="blue-grey darken-3"
              style="overflow-y: none"
            >
              <v-card-title>
                Locked Camera Settings
              </v-card-title>
              <v-card-text v-if="clientSettings.annotatorPreferences.lockedCamera">
                <v-row class="align-center" dense>
                  <v-col>
                    <v-switch
                      v-model="transitionVal"
                      small
                      label="Transition"
                      @change="clientSettings.annotatorPreferences.lockedCamera.transition = clientSettings.annotatorPreferences.lockedCamera.transition ? false : 200"
                    />
                  </v-col>
                  <v-col
                    cols="2"
                    align="right"
                  >
                    <v-tooltip
                      open-delay="200"
                      bottom
                    >
                      <template #activator="{ on }">
                        <v-icon
                          small
                          v-on="on"
                        >
                          mdi-help
                        </v-icon>
                      </template>
                      <span>Enables a transition to see where in the image the selected track is located</span>
                    </v-tooltip>
                  </v-col>
                </v-row>
                <v-row v-if="!!clientSettings.annotatorPreferences.lockedCamera.transition" class="align-center" dense>
                  <v-col>
                    Transition Time (ms):
                  </v-col>
                  <v-col>
                    <v-slider
                      :value="clientSettings.annotatorPreferences.lockedCamera.transition"
                      min="100"
                      max="2000"
                      step="50"
                      dense
                      hide-details
                      thumb-label="always"
                      @change="clientSettings.annotatorPreferences.lockedCamera.transition = $event"
                    />
                  </v-col>
                </v-row>
                <v-row class="align-center" dense>
                  <v-col>
                    <v-switch
                      v-model="multBoundsVal"
                      small
                      label="Multiply Bounds"
                      @change="clientSettings.annotatorPreferences.lockedCamera.multiBounds = clientSettings.annotatorPreferences.lockedCamera.multiBounds ? false : 2"
                    />
                  </v-col>
                  <v-col
                    cols="2"
                    align="right"
                  >
                    <v-tooltip
                      open-delay="200"
                      bottom
                    >
                      <template #activator="{ on }">
                        <v-icon
                          small
                          v-on="on"
                        >
                          mdi-help
                        </v-icon>
                      </template>
                      <span>If set this will zoom into a Y times the bounds around the selected track.  If not set it will use the current zoom level</span>
                    </v-tooltip>
                  </v-col>
                </v-row>
                <v-row v-if="!!clientSettings.annotatorPreferences.lockedCamera.multiBounds" class="align-center" dense>
                  <v-col>
                    Multiply Bounds:
                  </v-col>
                  <v-col>
                    <v-slider
                      :value="clientSettings.annotatorPreferences.lockedCamera.multiBounds"
                      min="1"
                      max="4"
                      step="0.1"
                      dense
                      hide-details
                      thumb-label="always"
                      @change="clientSettings.annotatorPreferences.lockedCamera.multiBounds = $event"
                    />
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-menu>
          <v-btn
            icon
            small
            title="(r)eset pan and zoom"
            @click="mediaController.resetZoom"
          >
            <v-icon>mdi-image-filter-center-focus</v-icon>
          </v-btn>
          <v-badge
            :value="!isDefaultImage"
            color="warning"
            dot
            overlap
            bottom
          >
            <v-btn
              icon
              small
              :title="!isDefaultImage ? 'Image Enhancements (Modified)' : 'Image Enhancements'"
              @click="toggleEnhancements"
            >
              <v-icon>mdi-contrast-box</v-icon>
            </v-btn>
          </v-badge>

          <v-btn
            v-if="mediaController.cameras.value.length > 1"
            icon
            small
            :color="mediaController.cameraSync.value ? 'primary' : 'default'"
            title="Synchronize camera controls"

            @click="mediaController.toggleSynchronizeCameras(!mediaController.cameraSync.value)"
          >
            <v-icon>
              {{ mediaController.cameraSync.value ? 'mdi-link' : 'mdi-link-off' }}
            </v-icon>
          </v-btn>
        </v-col>
      </v-row>
    </v-card>
  </div>
</template>
