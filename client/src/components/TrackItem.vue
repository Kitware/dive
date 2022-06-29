<script lang="ts">
import {
  defineComponent, computed, PropType, ref,
} from '@vue/composition-api';
import context from 'dive-common/store/context';
import TooltipBtn from './TooltipButton.vue';
import TypePicker from './TypePicker.vue';
import {
  useHandler, useTime, useReadOnlyMode, useTrackFilters, useCameraStore,
} from '../provides';
import Track from '../track';

export default defineComponent({
  name: 'TrackItem',

  components: { TooltipBtn, TypePicker },

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
  },

  setup(props, { root, emit }) {
    const vuetify = root.$vuetify;
    const { frame: frameRef } = useTime();
    const handler = useHandler();
    const trackFilters = useTrackFilters();
    const allTypesRef = trackFilters.allTypes;
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const multiCam = ref(cameraStore.camMap.value.size > 1);
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

    function setTrackType(type: string) {
      cameraStore.setTrackType(props.track.id, type);
    }

    function openMultiCamTools() {
      if (context.state.active !== 'MultiCamTools') {
        context.toggle('MultiCamTools');
      }
    }

    return {
      /* data */
      feature,
      isTrack,
      style,
      frame: frameRef,
      allTypes: allTypesRef,
      keyframeDisabled,
      trackFilters,
      readOnlyMode,
      multiCam,
      /* methods */
      gotoNext,
      gotoPrevious,
      handler,
      openMultiCamTools,
      toggleInterpolation,
      toggleKeyframe,
      setTrackType,
    };
  },
});
</script>

<template>
  <div
    class="track-item d-flex flex-column align-start hover-show-parent px-1"
    :style="style"
  >
    <v-row
      class="pt-2 justify-center item-row"
      no-gutters
    >
      <div
        v-if="solo"
        class="type-color-box"
        :style="{
          backgroundColor: color,
        }"
      />
      <v-checkbox
        v-else
        class="my-0 ml-1 pt-0"
        dense
        hide-details
        :input-value="inputValue"
        :color="color"
        @change="trackFilters.updateCheckedId(track.trackId, $event)"
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
            @click.self="handler.trackSeek(track.trackId)"
          >
            {{ track.trackId }}
          </div>
        </template>
        <span> {{ track.trackId }} </span>
      </v-tooltip>
      <v-spacer />
      <TypePicker
        :value="trackType"
        v-bind="{ lockTypes, readOnlyMode, allTypes, selected }"
        @input="setTrackType($event)"
      />
    </v-row>
    <v-row
      class="my-1 justify-center item-row flex-nowrap"
      no-gutters
    >
      <v-spacer v-if="!isTrack" />
      <template v-if="selected">
        <span
          v-show="false"
          v-mousetrap="[
            { bind: 'k', handler: toggleKeyframe},
            { bind: 'i', handler: toggleInterpolation},
            { bind: 'home', handler: () => $emit('seek', track.begin)},
            { bind: 'end', handler: () => $emit('seek', track.end)},
          ]"
        />
        <tooltip-btn
          color="error"
          icon="mdi-delete"
          :disabled="merging || readOnlyMode"
          :tooltip-text="`Delete ${isTrack ? 'Track' : 'Detection'}`"
          @click="handler.removeTrack([track.trackId])"
        />
        <span v-if="!multiCam">
          <tooltip-btn
            v-if="isTrack"
            :disabled="!track.canSplit(frame) || merging || readOnlyMode"
            icon="mdi-call-split"
            tooltip-text="Split Track"
            @click="handler.trackSplit(track.trackId, frame)"
          />

          <tooltip-btn
            v-if="isTrack && !readOnlyMode"
            :icon="(feature.isKeyframe)
              ? 'mdi-star'
              : 'mdi-star-outline'"
            :disabled="keyframeDisabled"
            tooltip-text="Toggle keyframe"
            @click="toggleKeyframe"
          />

          <tooltip-btn
            v-if="isTrack && !readOnlyMode"
            :icon="(feature.shouldInterpolate)
              ? 'mdi-vector-selection'
              : 'mdi-selection-off'"
            tooltip-text="Toggle interpolation"
            @click="toggleInterpolation"
          />
        </span>
        <span v-else>
          <tooltip-btn
            icon="mdi-camera"
            tooltip-text="Open MultiCamera Tools"
            @click="openMultiCamTools"
          />
        </span>
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
        v-if="!merging"
        :icon="(editing) ? 'mdi-pencil-box' : 'mdi-pencil-box-outline'"
        tooltip-text="Toggle edit mode"
        :disabled="!inputValue || readOnlyMode"
        @click="handler.trackEdit(track.trackId)"
      />
    </v-row>
  </div>
</template>

<style lang="scss" scoped>
@import 'src/components/styles/common.scss';

.track-item {
  border-radius: inherit;

  .item-row {
    width: 100%;
  }

  .type-color-box {
    margin: 7px;
    margin-top: 4px;
    min-width: 15px;
    max-width: 15px;
    min-height: 15px;
    max-height: 15px;
  }
}
</style>
