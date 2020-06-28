<script>
export default {
  name: 'TrackItem',

  props: {
    trackType: {
      type: String,
      required: true,
    },
    trackId: {
      type: Number,
      required: true,
    },
    types: {
      type: Array,
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
    splittable: {
      type: Boolean,
      default: false,
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
    onFocus(e) {
      if (!this.skipOnFocus) {
        this.value = '';
      }
      this.skipOnFocus = false;
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
      class="px-3 pb-2 justify-center item-row"
    >
      <v-btn
        small
        icon
      >
        <v-icon>mdi-chevron-double-left</v-icon>
      </v-btn>
      <v-btn
        small
        icon
      >
        <v-icon>mdi-chevron-left</v-icon>
      </v-btn>
      <v-btn
        small
        icon
      >
        <v-icon>mdi-chevron-right</v-icon>
      </v-btn>
      <v-btn
        small
        icon
      >
        <v-icon>mdi-chevron-double-right</v-icon>
      </v-btn>
      <v-spacer />
      <v-btn
        small
        icon
      >
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
      <v-btn
        small
        icon
        :disabled="!selected"
      >
        <v-icon>mdi-star-outline</v-icon>
      </v-btn>
      <v-btn
        small
        icon
        :disabled="!selected"
      >
        <v-icon>mdi-call-split</v-icon>
      </v-btn>
      <v-btn
        small
        icon
        color="error"
        :disabled="!selected"
      >
        <v-icon>mdi-delete</v-icon>
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
