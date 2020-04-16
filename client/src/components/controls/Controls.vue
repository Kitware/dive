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
      { bind: 'left', handler: previousFrame },
      { bind: 'right', handler: nextFrame },
      { bind: 'space', handler: togglePlay }
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
        <v-row>
          <v-spacer />
          <v-btn
            icon
            small
            title="Left key"
            @click="previousFrame"
          >
            <v-icon>mdi-skip-previous</v-icon>
          </v-btn>
          <v-btn
            v-if="!annotator.playing"
            icon
            small
            title="Space key"
            @click="annotator.$emit('play')"
          >
            <v-icon>mdi-play</v-icon>
          </v-btn>
          <v-btn
            v-else
            icon
            small
            title="Space key"
            @click="annotator.$emit('pause')"
          >
            <v-icon>mdi-pause</v-icon>
          </v-btn>
          <v-btn
            icon
            small
            title="Right key"
            @click="nextFrame"
          >
            <v-icon>mdi-skip-next</v-icon>
          </v-btn>
          <v-spacer />
        </v-row>
      </v-container>
    </v-toolbar>
  </div>
</template>
