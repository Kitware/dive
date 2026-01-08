<script lang="ts">
import {
  defineComponent, computed, PropType, ref, nextTick,
} from 'vue';
import context from 'dive-common/store/context';
import TooltipBtn from './TooltipButton.vue';
import TypePicker from './TypePicker.vue';
import {
  useHandler, useTime, useReadOnlyMode, useTrackFilters, useCameraStore, useTrackStyleManager,
} from '../provides';
import Track from '../track';
import useVuetify from '../use/useVuetify';

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
    disabled: {
      type: Boolean,
      default: false,
    },
    compact: {
      type: Boolean,
      default: false,
    },
  },

  setup(props, { emit }) {
    const vuetify = useVuetify();
    const { frame: frameRef } = useTime();
    const handler = useHandler();
    const trackFilters = useTrackFilters();
    const allTypesRef = trackFilters.allTypes;
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const { typeStyling } = useTrackStyleManager();
    const multiCam = ref(cameraStore.camMap.value.size > 1);

    /* Compact mode editing state */
    const editingType = ref(false);
    const editingConfidence = ref(false);
    const editingNotes = ref(false);
    const editTypeValue = ref('');
    const editConfidenceValue = ref('');
    const editNotesValue = ref('');
    const localNotesDisplay = ref('');
    const typeInputRef = ref<HTMLInputElement | HTMLSelectElement | null>(null);
    const confidenceInputRef = ref<HTMLInputElement | null>(null);
    const notesInputRef = ref<HTMLInputElement | null>(null);
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

    /* Get the top confidence value for display in compact mode */
    const topConfidence = computed(() => {
      // Access revision.value to create reactive dependency
      if (props.track.revision.value !== undefined
          && props.track.confidencePairs
          && props.track.confidencePairs.length > 0) {
        return props.track.confidencePairs[0][1];
      }
      return null;
    });

    /* Get the notes value from the track's first keyframe */
    const currentNotes = computed(() => {
      // Use local display value if set, otherwise read from track
      if (localNotesDisplay.value) {
        return localNotesDisplay.value;
      }
      // Access revision.value to create reactive dependency
      if (props.track.revision.value !== undefined) {
        // Use track.begin frame for notes (first keyframe)
        const feature = props.track.features[props.track.begin];
        if (feature && feature.notes && feature.notes.length > 0) {
          return feature.notes.join(', ');
        }
      }
      return '';
    });

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

    function setTrackType(type: string) {
      cameraStore.setTrackType(props.track.id, type);
    }

    function openMultiCamTools() {
      if (context.state.active !== 'MultiCamTools') {
        context.toggle('MultiCamTools');
      }
    }

    function handleClicked(event: PointerEvent) {
      const modifiers = event.ctrlKey ? { ctrl: true } : undefined;
      handler.trackSeek(props.track.trackId, modifiers);
    }

    /* Compact mode inline editing */
    function startEditType(event: MouseEvent) {
      if (readOnlyMode.value) return;
      event.stopPropagation();
      editTypeValue.value = props.trackType;
      editingType.value = true;
      nextTick(() => {
        typeInputRef.value?.focus();
        if (typeInputRef.value instanceof HTMLInputElement) {
          typeInputRef.value.select();
        }
      });
    }

    function saveType() {
      if (editTypeValue.value.trim() && editTypeValue.value !== props.trackType) {
        const confidence = topConfidence.value !== null ? topConfidence.value : 1;
        props.track.setType(editTypeValue.value.trim(), confidence, props.trackType);
      }
      editingType.value = false;
    }

    function cancelEditType() {
      editingType.value = false;
    }

    function startEditConfidence(event: MouseEvent) {
      if (readOnlyMode.value) return;
      event.stopPropagation();
      editConfidenceValue.value = topConfidence.value !== null ? topConfidence.value.toFixed(2) : '1.00';
      editingConfidence.value = true;
      nextTick(() => {
        confidenceInputRef.value?.focus();
        confidenceInputRef.value?.select();
      });
    }

    function saveConfidence() {
      const val = parseFloat(editConfidenceValue.value);
      if (!Number.isNaN(val) && val >= 0 && val <= 1) {
        // Use cameraStore.setTrackType to update across all cameras
        cameraStore.setTrackType(props.track.id, props.trackType, val);
      }
      editingConfidence.value = false;
    }

    function cancelEditConfidence() {
      editingConfidence.value = false;
    }

    function startEditNotes(event: MouseEvent) {
      if (readOnlyMode.value) return;
      event.stopPropagation();
      editNotesValue.value = currentNotes.value;
      editingNotes.value = true;
      nextTick(() => {
        notesInputRef.value?.focus();
        notesInputRef.value?.select();
      });
    }

    function saveNotes() {
      const newNotes = editNotesValue.value.trim();
      // Save notes to the track's first keyframe (track.begin)
      props.track.setFeatureNotes(props.track.begin, newNotes);
      // Update local display immediately for UI responsiveness
      localNotesDisplay.value = newNotes;
      editingNotes.value = false;
    }

    function cancelEditNotes() {
      editingNotes.value = false;
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
      topConfidence,
      /* compact editing */
      editingType,
      editingConfidence,
      editingNotes,
      editTypeValue,
      editConfidenceValue,
      editNotesValue,
      localNotesDisplay,
      typeInputRef,
      confidenceInputRef,
      notesInputRef,
      currentNotes,
      /* methods */
      gotoNext,
      gotoPrevious,
      handler,
      openMultiCamTools,
      toggleInterpolation,
      clickToggleInterpolation,
      toggleAllInterpolation,
      toggleKeyframe,
      setTrackType,
      typeStyling,
      handleClicked,
      startEditType,
      saveType,
      cancelEditType,
      startEditConfidence,
      saveConfidence,
      cancelEditConfidence,
      startEditNotes,
      saveNotes,
      cancelEditNotes,
    };
  },
});
</script>

<template>
  <!-- Compact layout for bottom sidebar -->
  <div
    v-if="compact"
    class="track-item-compact d-flex align-center hover-show-parent px-1"
    :style="style"
    @click="handleClicked"
  >
    <div
      class="type-color-box-compact"
      :style="{ backgroundColor: color }"
    />
    <div class="trackNumber-compact">
      {{ track.trackId }}
    </div>
    <!-- Editable type field -->
    <select
      v-if="editingType && lockTypes"
      ref="typeInputRef"
      v-model="editTypeValue"
      class="compact-type-input compact-select-input"
      @blur="saveType"
      @change="saveType"
      @keydown.enter="saveType"
      @keydown.escape="cancelEditType"
      @click.stop
    >
      <option
        v-for="item in allTypes"
        :key="item"
        :value="item"
      >
        {{ item }}
      </option>
    </select>
    <input
      v-else-if="editingType"
      ref="typeInputRef"
      v-model="editTypeValue"
      type="text"
      list="allTypesOptions"
      class="compact-type-input"
      @blur="saveType"
      @keydown.enter="saveType"
      @keydown.escape="cancelEditType"
      @click.stop
    >
    <span
      v-else
      class="track-type-compact text-truncate"
      :class="{ editable: !readOnlyMode && !lockTypes }"
      @click="startEditType"
    >{{ trackType }}</span>
    <!-- Editable confidence field -->
    <input
      v-if="editingConfidence"
      ref="confidenceInputRef"
      v-model="editConfidenceValue"
      type="number"
      step="0.01"
      min="0"
      max="1"
      class="compact-confidence-input"
      @blur="saveConfidence"
      @keydown.enter="saveConfidence"
      @keydown.escape="cancelEditConfidence"
      @click.stop
    >
    <span
      v-else
      class="track-confidence-compact"
      :class="{ editable: !readOnlyMode }"
      @click="startEditConfidence"
    >
      {{ topConfidence !== null ? topConfidence.toFixed(2) : '' }}
    </span>
    <!-- Start and end frame columns -->
    <span class="track-frame-start">{{ track.begin }}</span>
    <span class="track-frame-end">{{ track.end }}</span>
    <!-- Notes field -->
    <input
      v-if="editingNotes"
      ref="notesInputRef"
      v-model="editNotesValue"
      type="text"
      class="compact-notes-input"
      placeholder="Add notes..."
      @blur="saveNotes"
      @keydown.enter="saveNotes"
      @keydown.escape="cancelEditNotes"
      @click.stop
    >
    <span
      v-else
      class="track-notes-compact text-truncate"
      :class="{ editable: !readOnlyMode, 'has-notes': currentNotes }"
      @click="startEditNotes"
    >{{ currentNotes || '...' }}</span>
    <v-spacer />
    <!-- Compact action buttons -->
    <div class="compact-actions d-flex">
      <tooltip-btn
        v-if="isTrack"
        icon="mdi-chevron-double-left"
        tooltip-text="Seek to start"
        size="x-small"
        @click="$emit('seek', track.begin)"
      />
      <tooltip-btn
        v-if="isTrack"
        icon="mdi-chevron-double-right"
        tooltip-text="Seek to end"
        size="x-small"
        @click="$emit('seek', track.end)"
      />
      <tooltip-btn
        v-if="!isTrack"
        icon="mdi-map-marker"
        tooltip-text="Seek to detection"
        size="x-small"
        @click="$emit('seek', track.begin)"
      />
      <tooltip-btn
        v-if="!merging"
        :icon="(editing) ? 'mdi-pencil-box' : 'mdi-pencil-box-outline'"
        tooltip-text="Toggle edit mode"
        size="x-small"
        :disabled="!inputValue || readOnlyMode"
        @click="handler.trackEdit(track.trackId)"
      />
      <tooltip-btn
        icon="mdi-delete"
        color="error"
        tooltip-text="Delete track"
        size="x-small"
        :disabled="merging || readOnlyMode"
        @click="handler.removeTrack([track.trackId])"
      />
    </div>
    <span
      v-show="false"
      v-mousetrap="[
        { bind: 'k', handler: toggleKeyframe },
        { bind: 'i', handler: toggleInterpolation },
        { bind: 'ctrl+i', handler: toggleAllInterpolation },
        { bind: 'home', handler: () => $emit('seek', track.begin) },
        { bind: 'end', handler: () => $emit('seek', track.end) },
      ]"
    />
  </div>
  <!-- Standard layout -->
  <div
    v-else
    class="track-item d-flex flex-column align-start hover-show-parent px-1"
    :style="style"
  >
    <v-row
      class="pt-2 justify-center item-row"
      no-gutters
      align="center"
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
        :disabled="disabled"
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
            @click.self="handleClicked"
          >
            {{ track.trackId }}
          </div>
        </template>
        <span> {{ track.trackId }} </span>
      </v-tooltip>
      <v-chip
        v-if="track.set"
        outlined
        x-small
        :color="typeStyling.annotationSetColor(track.set)"
      >
        {{ track.set }}
      </v-chip>

      <v-spacer />
      <TypePicker
        :value="trackType"
        v-bind="{
          lockTypes, readOnlyMode, allTypes, selected,
        }"
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
            { bind: 'k', handler: toggleKeyframe },
            { bind: 'i', handler: toggleInterpolation },
            { bind: 'ctrl+i', handler: toggleAllInterpolation },
            { bind: 'home', handler: () => $emit('seek', track.begin) },
            { bind: 'end', handler: () => $emit('seek', track.end) },
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
            tooltip-text="Toggle interpolation, ctrl+click to toggle all interpolation"
            @click="clickToggleInterpolation($event)"
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

.track-item-compact {
  border-radius: inherit;
  height: 50px;
  border-bottom: 1px solid #333;
  cursor: pointer;

  &:hover {
    background-color: #2a2a2a;
  }

  .type-color-box-compact {
    min-width: 10px;
    max-width: 10px;
    min-height: 10px;
    max-height: 10px;
    margin-right: 6px;
    border-radius: 2px;
  }

  .trackNumber-compact {
    font-size: 13px;
    font-weight: bold;
    margin-right: 8px;
    min-width: 30px;
  }

  .track-frame-start,
  .track-frame-end {
    font-size: 11px;
    color: #888;
    min-width: 45px;
    flex-shrink: 0;
    text-align: right;
  }

  .track-frame-end {
    margin-right: 8px;
  }

  .track-notes-compact {
    font-size: 11px;
    color: #666;
    flex-grow: 1;
    min-width: 60px;
    max-width: 200px;
    padding: 1px 4px;
    margin-left: 12px;

    &.has-notes {
      color: #aaa;
    }

    &.editable {
      cursor: text;
      &:hover {
        color: #fff;
        text-decoration: underline;
      }
    }
  }

  .compact-notes-input {
    font-size: 11px;
    flex-grow: 1;
    min-width: 60px;
    max-width: 200px;
    background-color: #333;
    border: 1px solid #666;
    border-radius: 3px;
    color: #fff;
    padding: 1px 4px;
    margin-left: 12px;
    outline: none;

    &:focus {
      border-color: #888;
    }
  }

  .track-type-compact {
    font-size: 12px;
    color: #aaa;
    width: 80px;
    min-width: 80px;
    flex-shrink: 0;

    &.editable {
      cursor: text;
      &:hover {
        color: #fff;
        text-decoration: underline;
      }
    }
  }

  .track-confidence-compact {
    font-size: 11px;
    color: #888;
    width: 40px;
    min-width: 40px;
    flex-shrink: 0;
    text-align: right;
    background-color: #333;
    padding: 1px 4px;
    border-radius: 3px;
    margin-right: 8px;

    &.editable {
      cursor: text;
      &:hover {
        color: #fff;
        background-color: #444;
      }
    }
  }

  .compact-type-input {
    font-size: 12px;
    width: 80px;
    min-width: 80px;
    flex-shrink: 0;
    background-color: #333;
    border: 1px solid #666;
    border-radius: 3px;
    color: #fff;
    padding: 1px 4px;
    outline: none;

    &:focus {
      border-color: #888;
    }
  }

  .compact-select-input {
    appearance: menulist;
    background-color: #333;
  }

  .compact-confidence-input {
    font-size: 11px;
    width: 46px;
    min-width: 46px;
    flex-shrink: 0;
    background-color: #333;
    border: 1px solid #666;
    border-radius: 3px;
    color: #fff;
    padding: 1px 4px;
    text-align: right;
    outline: none;

    &:focus {
      border-color: #888;
    }

    /* Hide spinner buttons */
    -moz-appearance: textfield;
    &::-webkit-outer-spin-button,
    &::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  }

  .compact-actions {
    flex-shrink: 0;
  }
}
</style>
