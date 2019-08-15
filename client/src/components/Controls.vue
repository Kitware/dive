<script>
export default {
  name: "Control",
  inject: ["annotator"],
  data: () => ({
    frame_: 0,
    dragging: false
  }),
  watch: {
    "annotator.frame"(value) {
      if (!this.dragging) {
        this.frame_ = value;
      }
    }
  },
  methods: {
    rendered() {
      // console.log("rendered");
    },
    dragStart() {
      this.dragging = true;
    },
    dragEnd() {
      this.dragging = false;
    },
    input(value) {
      if (this.annotator.frame !== value) {
        this.annotator.$emit("seek", value);
      }
      this.frame_ = this.annotator.frame;
    }
  }
};
</script>

<template>
  <div>
    <v-toolbar height="80px">
      <v-container fluid class="pa-0">
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
            v-if="!annotator.playing"
            @click="annotator.$emit('play')"
          >
            <v-icon>mdi-play</v-icon>
          </v-btn>
          <v-btn icon small v-else @click="annotator.$emit('pause')">
            <v-icon>mdi-pause</v-icon>
          </v-btn>
          <div>{{ rendered() }}</div>
          <v-spacer />
        </v-row>
      </v-container>
    </v-toolbar>
  </div>
</template>
