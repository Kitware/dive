<script>
export default {
  name: 'Control',
  inject: ['annotator'],
  data() {
    return {
      frame_: 0,
      dragging: false,
    };
  },
  watch: {
    'annotator.frame': {
      handler(value) {
        if (!this.dragging) {
          this.frame_ = value;
        }
      },
    },
  },
  methods: {
    dragStart() {
      this.dragging = true;
    },
    dragEnd() {
      this.dragging = false;
    },
    input(value) {
      if (this.annotator.frame !== value) {
        this.annotator.$emit('seek', value);
      }
      this.frame_ = this.annotator.frame;
    },
    togglePlay() {
      if (this.annotator.playing) {
        this.annotator.$emit('pause');
      } else {
        this.annotator.$emit('play');
      }
    },
    previousFrame() {
      this.annotator.$emit('prev-frame');
    },
    nextFrame() {
      this.annotator.$emit('next-frame');
    },
  },
};
</script>

<template>
  <div
    v-mousetrap="[
      { bind: 'left', handler: previousFrame, disabled: $prompt.visible() },
      { bind: 'right', handler: nextFrame, disabled: $prompt.visible()},
      { bind: 'space', handler: togglePlay, disabled: $prompt.visible() },
      { bind: 'f', handler: nextFrame, disabled: $prompt.visible() },
      { bind: 'd', handler: previousFrame, disabled: $prompt.visible() },
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
            :max="annotator.maxFrame"
            :value="frame_"
            @start="dragStart"
            @end="dragEnd"
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
              @click="previousFrame"
            >
              <v-icon>mdi-skip-previous</v-icon>
            </v-btn>
            <v-btn
              v-if="!annotator.playing"
              icon
              small
              title="(space) Play"
              @click="annotator.$emit('play')"
            >
              <v-icon>mdi-play</v-icon>
            </v-btn>
            <v-btn
              v-else
              icon
              small
              title="(space) Pause"
              @click="annotator.$emit('pause')"
            >
              <v-icon>mdi-pause</v-icon>
            </v-btn>
            <v-btn
              icon
              small
              title="(f, right-arrow) next frame"
              @click="nextFrame"
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
              @click="annotator.$emit('reset-zoom')"
            >
              <v-icon>mdi-image-filter-center-focus</v-icon>
            </v-btn>
          </v-col>
        </v-row>
      </v-container>
    </v-toolbar>
  </div>
</template>
