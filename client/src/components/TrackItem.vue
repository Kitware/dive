<script lang="ts">
import {
  defineComponent, computed, watch, reactive, PropType, toRef, ref,
} from '@vue/composition-api';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import { useFrame } from 'vue-media-annotator/provides';
import Track from 'vue-media-annotator/track';

export default defineComponent({
  name: 'TrackItem',

  components: { TooltipBtn },

  props: {
    trackType: {
      type: String,
      required: true,
    },
    track: {
      type: Object as PropType<Track>,
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

  setup(props, { root, emit }) {
    const vuetify = root.$vuetify;
    const frameRef = useFrame();
    const trackTypeRef = toRef(props, 'trackType');
    const typeInputBoxRef = ref(undefined as undefined | HTMLInputElement);
    const data = reactive({
      trackTypeValue: props.trackType,
      skipOnFocus: false,
    });

    /* Use of revision is safe because it will only create a dependency when track is selected */
    const feature = computed(() => {
      if (props.track.revision.value) {
        const { features, interpolate } = props.track.canInterpolate(frameRef.value);
        const [real, lower, upper] = features;
        return {
          real,
          lower,
          upper,
          shouldInterpolate: interpolate,
          targetKeyframe: real?.keyframe ? real : (lower || upper),
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
    });

    /* isTrack distinguishes between track and detection */
    const isTrack = computed(() => props.track.length > 1 || feature.value.shouldInterpolate);

    /* Sets styling for the selected track */
    const style = computed(() => {
      if (props.selected) {
        return {
          'background-color': `${vuetify.theme.themes.dark.accentBackground}`,
        };
      }
      return {};
    });

    /* Update internal model if external prop changes */
    watch(trackTypeRef, (val) => { data.trackTypeValue = val; });

    function focusType() {
      if (props.selected && typeInputBoxRef.value !== undefined) {
        data.skipOnFocus = true;
        typeInputBoxRef.value.focus();
        typeInputBoxRef.value.select();
      }
    }

    function blurType(e: InputEvent) {
      (e.target as HTMLInputElement).blur();
    }

    function onBlur() {
      if (data.trackTypeValue === '') {
        data.trackTypeValue = props.trackType;
      } else if (data.trackTypeValue !== props.trackType) {
        emit('type-change', data.trackTypeValue);
      }
    }

    function onFocus() {
      if (!data.skipOnFocus) {
        data.trackTypeValue = '';
      }
      data.skipOnFocus = false;
    }

    function toggleKeyframe() {
      const f = feature.value;
      if (f.real && f.isKeyframe) {
        props.track.setFeature({
          ...f.real,
          frame: frameRef.value,
          keyframe: true,
        });
      } else {
        props.track.deleteFeature(frameRef.value);
      }
    }

    function toggleInterpolation() {
      const f = feature.value;
      if (f.targetKeyframe) {
        props.track.setFeature({
          ...f.targetKeyframe,
          interpolate: !f.shouldInterpolate,
        });
      }
    }

    function gotoNext() {
      const nextFrame = props.track.getNextKeyframe(frameRef.value + 1);
      if (nextFrame !== undefined) {
        emit('seek', nextFrame);
      }
    }

    function gotoPrevious() {
      const previousFrame = props.track.getPreviousKeyframe(frameRef.value - 1);
      if (previousFrame !== undefined) {
        emit('seek', previousFrame);
      }
    }

    return {
      /* data */
      data,
      feature,
      isTrack,
      style,
      typeInputBox: typeInputBoxRef,
      frame: frameRef,
      /* methods */
      blurType,
      focusType,
      gotoNext,
      gotoPrevious,
      onBlur,
      onFocus,
      toggleInterpolation,
      toggleKeyframe,
    };
  },
});
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
      <v-tooltip
        open-delay="200"
        bottom
        max-width="200"
        :disabled="track.trackId.toString().length < 8"
      >
        <template #activator="{ on }">
          <div
            class="trackNumber pl-0 pr-2"
            v-on="on"
            @click.self="$emit('click')"
          >
            {{ track.trackId }}
          </div>
        </template>
        <span> {{ track.trackId }} </span>
      </v-tooltip>
      <v-spacer />
      <input
        ref="typeInputBoxRef"
        v-model="data.trackTypeValue"
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
    <v-row class="px-3 py-1 justify-center item-row flex-nowrap">
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
          :disabled="!track.canSplit(frame)"
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
    max-width: 80px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
    width: 135px;
    color: white;
  }
}
</style>
