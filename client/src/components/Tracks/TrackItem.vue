<script lang="ts">
import {
  defineComponent, computed, PropType,
} from 'vue';
import { ColumnVisibilitySettings } from 'dive-common/store/settings';
import SideBarTrackItemView from './sidebar/SideBarTrackItemView.vue';
import BottomBarTrackItemView from './bottombar/BottomBarTrackItemView.vue';
import { useTime } from '../../provides';
import Track from '../../track';
import useVuetify from '../../use/useVuetify';

export default defineComponent({
  name: 'TrackItem',

  components: { SideBarTrackItemView, BottomBarTrackItemView },

  props: {
    solo: {
      type: Boolean,
      default: false,
    },
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
    secondarySelected: {
      type: Boolean,
      required: true,
    },
    editing: {
      type: Boolean,
      required: true,
    },
    merging: {
      type: Boolean,
      default: false,
    },
    color: {
      type: String,
      required: true,
    },
    lockTypes: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    compact: {
      type: Boolean,
      default: false,
    },
    columnVisibility: {
      type: Object as PropType<ColumnVisibilitySettings>,
      default: null,
    },
    fps: {
      type: Number,
      default: null,
    },
  },

  setup(props, { emit }) {
    const vuetify = useVuetify();
    const { frame: frameRef } = useTime();

    /**
     * Use of revision is safe because it will only create a
     * dependency when track is selected.  DO NOT use this computed
     * value except inside if (props.selected === true) blocks!
     */
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
      if (props.secondarySelected) {
        return {
          'background-color': '#3a3a3a',
        };
      }
      return {};
    });

    const keyframeDisabled = computed(() => (
      !feature.value.real && !feature.value.shouldInterpolate)
      || (props.track.length === 1 && frameRef.value === props.track.begin));

    function toggleKeyframe() {
      if (!keyframeDisabled.value) {
        props.track.toggleKeyframe(frameRef.value);
      }
    }

    function toggleInterpolation() {
      props.track.toggleInterpolation(frameRef.value);
    }

    function toggleAllInterpolation() {
      props.track.toggleInterpolationForAllGaps(frameRef.value);
    }

    function clickToggleInterpolation(event: MouseEvent) {
      if (event.ctrlKey) {
        toggleAllInterpolation();
      } else {
        toggleInterpolation();
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
      feature,
      isTrack,
      style,
      frame: frameRef,
      keyframeDisabled,
      /* methods */
      gotoNext,
      gotoPrevious,
      toggleInterpolation,
      clickToggleInterpolation,
      toggleAllInterpolation,
      toggleKeyframe,
    };
  },
});
</script>

<template>
  <bottom-bar-track-item-view
    v-if="compact"
    v-bind="$props"
    :item-style="style"
    :toggle-keyframe="toggleKeyframe"
    :toggle-interpolation="toggleInterpolation"
    :toggle-all-interpolation="toggleAllInterpolation"
    @seek="$emit('seek', $event)"
  />
  <side-bar-track-item-view
    v-else
    v-bind="$props"
    :item-style="style"
    :is-track="isTrack"
    :feature="feature"
    :keyframe-disabled="keyframeDisabled"
    :frame="frame"
    :toggle-keyframe="toggleKeyframe"
    :click-toggle-interpolation="clickToggleInterpolation"
    :toggle-interpolation="toggleInterpolation"
    :toggle-all-interpolation="toggleAllInterpolation"
    :goto-previous="gotoPrevious"
    :goto-next="gotoNext"
    @seek="$emit('seek', $event)"
  />
</template>
