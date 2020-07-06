<script>
import TooltipBtn from './TooltipButton.vue';

export default {
  name: 'TrackItem',

  components: { TooltipBtn },

  props: {
    trackType: {
      type: String,
      required: true,
    },
    types: {
      type: Array,
      required: true,
    },
    frame: {
      type: Object,
      required: true,
    },
    track: {
      type: Object,
      required: true,
    },
    inputValue: {
      type: Boolean,
      required: true,
    },
    selected: {
      type: Boolean,
      required: true,
    },
    editing: {
      type: Boolean,
      required: true,
    },
    color: {
      type: String,
      required: true,
    },
  },

  data() {
    return {
      value: this.trackType,
      skipOnFocus: false,
    };
  },

  computed: {
    isTrack() {
      return this.track.length > 1 || this.feature.shouldInterpolate;
    },
    trackId() {
      return this.track.trackId;
    },
    /**
     * Sets styling for the selected track
     * Sets the background accent color to have a slight
     * opacity so it isn't overwhelming
     */
    style() {
      if (this.selected) {
        return {
          'background-color': `${this.$vuetify.theme.themes.dark.accentBackground}`,
        };
      }
      return {};
    },
    /**
     * Use of revision is safe because it will only create
     * a dependency when selected is true.
     */
    feature() {
      if (this.track.revision.value) {
        const { features, interpolate } = this.track.canInterpolate(this.frame.value);
        const [real, lower, upper] = features;
        return {
          real,
          lower,
          upper,
          // Upper an lower are always going to be keyframes
          targetKeyframe: real?.isKeyframe ? real : (lower || upper),
          shouldInterpolate: interpolate,
          isKeyframe: real?.keyframe,
        };
      }
      return {
        real: null,
        lower: null,
        upper: null,
        targetKeyframe: null,
        shouldInterpolate: false,
        isKeyframe: false,
      };
    },
  },
  methods: {
    focusType() {
      if (this.selected) {
        this.skipOnFocus = true;
        this.$refs.typeInputBox.focus();
        this.$refs.typeInputBox.select();
      }
    },
    blurType(e) {
      e.target.blur();
    },
    onBlur() {
      if (this.value === '') {
        this.value = this.trackType;
      } else if (this.value !== this.trackType) {
        this.$emit('type-change', this.value);
      }
    },
    onFocus() {
      if (!this.skipOnFocus) {
        this.value = '';
      }
      this.skipOnFocus = false;
    },
    toggleKeyframe() {
      if (this.feature.real && !this.feature.isKeyframe) {
        this.track.setFeature({
          ...this.feature.real,
          frame: this.frame.value,
          keyframe: true,
        });
      } else {
        this.track.deleteFeature(this.frame.value);
      }
    },
    toggleInterpolation() {
      if (this.feature.targetKeyframe) {
        this.track.setFeature({
          ...this.feature.targetKeyframe,
          interpolate: !this.feature.shouldInterpolate,
        });
      }
    },
    gotoNext() {
      const nextFrame = this.track.getNextKeyframe(this.frame.value + 1);
      if (nextFrame !== undefined) {
        this.$emit('seek', nextFrame);
      }
    },
    gotoPrevious() {
      const previousFrame = this.track.getPreviousKeyframe(this.frame.value - 1);
      if (previousFrame !== undefined) {
        this.$emit('seek', previousFrame);
      }
    },
  },
};
</script>

<template>
  <div
    v-mousetrap="[
      { bind: 'shift+enter', handler: focusType },
    ]"
    class="track-item d-flex flex-column align-start hover-show-parent px-1"
    :style="style"
  >
    <v-row class="px-3 pt-2 justify-center item-row">
      <v-checkbox
        class="my-0 ml-1 pt-0"
        dense
        hide-details
        :input-value="inputValue"
        :color="color"
        @change="$emit('change', $event)"
      />
      <div
        class="trackNumber pl-0 pr-2"
        @click.self="$emit('click')"
      >
        {{ trackId }}
      </div>
      <v-spacer />
      <input
        ref="typeInputBox"
        v-model="value"
        type="text"
        list="allTypesOptions"
        class="input-box"
        @focus="onFocus"
        @blur="onBlur"
        @keydown.esc="blurType"
        @keydown.enter="blurType"
        @keydown.down="value=''"
      >
    </v-row>
    <v-row
      class="px-3 py-1 justify-center item-row flex-nowrap"
    >
      <v-spacer v-if="!isTrack" />
      <template v-if="selected">
        <tooltip-btn
          color="error"
          icon="mdi-delete"
          :tooltip-text="`Delete ${isTrack ? 'Track' : 'Detection'}`"
          @click="$emit('delete')"
        />

        <tooltip-btn
          v-if="isTrack"
          :disabled="!track.canSplit(frame.value)"
          icon="mdi-call-split"
          tooltip-text="Split Track"
          @click="$emit('split')"
        />

        <tooltip-btn
          v-if="isTrack"
          :icon="(feature.isKeyframe)
            ? 'mdi-star'
            : 'mdi-star-outline'"
          :disabled="!feature.real"
          tooltip-text="Toggle keyframe"
          @click="toggleKeyframe"
        />

        <tooltip-btn
          v-if="isTrack"
          :icon="(feature.shouldInterpolate)
            ? 'mdi-vector-selection'
            : 'mdi-selection-off'"
          tooltip-text="Toggle interpolation"
          @click="toggleInterpolation"
        />
      </template>
      <v-spacer v-if="isTrack" />
      <template v-if="isTrack">
        <tooltip-btn
          icon="mdi-chevron-double-left"
          tooltip-text="Seek to track beginning"
          @click="$emit('seek', track.begin)"
        />

        <tooltip-btn
          icon="mdi-chevron-left"
          tooltip-text="Seek to previous keyframe"
          @click="gotoPrevious"
        />

        <tooltip-btn
          icon="mdi-chevron-right"
          tooltip-text="Seek to next keyframe"
          @click="gotoNext"
        />

        <tooltip-btn
          icon="mdi-chevron-double-right"
          tooltip-text="Seek to track end"
          @click="$emit('seek', track.end)"
        />
      </template>
      <tooltip-btn
        v-else
        icon="mdi-map-marker"
        tooltip-text="Seek to detection"
        @click="$emit('seek', track.begin)"
      />

      <tooltip-btn
        :icon="(editing) ? 'mdi-pencil-box' : 'mdi-pencil-box-outline'"
        tooltip-text="Toggle edit mode"
        :disabled="!inputValue"
        @click="$emit('edit')"
      />
    </v-row>
  </div>
</template>

<style lang="scss" scoped>
.track-item {
  .item-row {
    width: 100%;
  }

  .trackNumber {
    font-family: monospace;
    &:hover {
      cursor: pointer;
      font-weight: bolder;
      text-decoration: underline;
    }
  }
  .input-box {
    border: 1px solid rgb(255, 255, 255, 0.15);
    border-radius: 4px;
    padding: 0 6px;
    width: 160px;
    color: white;
  }
}
</style>
