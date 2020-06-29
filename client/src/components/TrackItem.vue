<script>
export default {
  name: 'TrackItem',

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
    editingTrack: {
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
    splittable() {
      return this.track.length > 1;
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
        const [real, lower, upper] = this.track.getFeature(this.frame.value);
        return {
          real,
          lower,
          upper,
        };
      }
      return {
        real: null,
        lower: null,
        upper: null,
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
      if (!this.feature.real.keyframe) {
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
      const newValue = this.feature.lower
        ? this.feature.lower.interpolate || false
        : (this.feature.upper && this.feature.upper.interpolate) || false;
      if (this.feature.lower || this.feature.upper) {
        this.track.setFeature({
          ...(this.feature.lower || this.feature.upper),
          interpolate: !newValue,
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
        {{ trackId + (editingTrack && selected ? "*" : "") }}
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
      class="px-3 py-1 justify-center item-row"
    >
      <template v-if="selected">
        <v-btn
          small
          icon
          color="error"
          @click="$emit('delete')"
        >
          <v-icon>mdi-delete</v-icon>
        </v-btn>

        <v-btn
          small
          icon
          :disabled="!(frame.value > track.begin && frame.value <= track.end)"
          @click="$emit('split')"
        >
          <v-icon>mdi-call-split</v-icon>
        </v-btn>
      </template>

      <template v-if="selected">
        <v-btn
          small
          icon
          :disabled="!feature.real"
          @click="toggleKeyframe"
        >
          <v-icon v-if="feature.real && feature.real.keyframe">
            mdi-star
          </v-icon>
          <v-icon v-else>
            mdi-star-outline
          </v-icon>
        </v-btn>

        <v-btn
          small
          icon
          @click="toggleInterpolation"
        >
          <v-icon
            v-if="
              (feature.real && feature.real.interpolate)
                || (feature.lower && feature.lower.interpolate)
                || ((feature.lower === null) && feature.upper && feature.upper.interpolate)
            "
          >
            mdi-vector-selection
          </v-icon>
          <v-icon v-else>
            mdi-selection-off
          </v-icon>
        </v-btn>
      </template>
      <v-spacer />
      <template v-if="track.length > 1">
        <v-btn
          small
          icon
          @click="$emit('seek', track.begin)"
        >
          <v-icon>mdi-chevron-double-left</v-icon>
        </v-btn>

        <v-btn
          small
          icon
          @click="gotoPrevious"
        >
          <v-icon>mdi-chevron-left</v-icon>
        </v-btn>

        <v-btn
          small
          icon
          @click="gotoNext"
        >
          <v-icon>mdi-chevron-right</v-icon>
        </v-btn>

        <v-btn
          small
          icon
          @click="$emit('seek', track.end)"
        >
          <v-icon>mdi-chevron-double-right</v-icon>
        </v-btn>
      </template>
      <template v-else>
        <v-btn
          small
          icon
          @click="$emit('seek', track.begin)"
        >
          <v-icon>mdi-map-marker</v-icon>
        </v-btn>
      </template>

      <v-btn
        small
        icon
        :disabled="!inputValue"
        @click="$emit('edit')"
      >
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
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
