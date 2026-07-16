<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import context from 'dive-common/store/context';
import TooltipBtn from '../../TooltipButton.vue';
import TypePicker from '../../TypePicker.vue';
import {
  useCameraStore,
  useHandler,
  useReadOnlyMode,
  useTrackFilters,
  useTrackStyleManager,
} from '../../../provides';

export default defineComponent({
  name: 'SideBarTrackItemView',
  components: { TooltipBtn, TypePicker },
  props: {
    solo: { type: Boolean, default: false },
    lockTypes: { type: Boolean, default: false },
    selected: { type: Boolean, required: true },
    trackType: { type: String, required: true },
    itemStyle: { type: Object, required: true },
    color: { type: String, required: true },
    track: { type: Object, required: true },
    inputValue: { type: Boolean, required: true },
    disabled: { type: Boolean, default: false },
    isTrack: { type: Boolean, required: true },
    feature: { type: Object, required: true },
    keyframeDisabled: { type: Boolean, required: true },
    frame: { type: Number, required: true },
    merging: { type: Boolean, default: false },
    toggleKeyframe: { type: Function, required: true },
    clickToggleInterpolation: { type: Function, required: true },
    toggleInterpolation: { type: Function, required: true },
    toggleAllInterpolation: { type: Function, required: true },
    gotoPrevious: { type: Function, required: true },
    gotoNext: { type: Function, required: true },
    editing: { type: Boolean, required: true },
  },
  setup(props) {
    const handler = useHandler();
    const trackFilters = useTrackFilters();
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const { typeStyling } = useTrackStyleManager();
    const multiCam = computed(() => cameraStore.camMap.value.size > 1);

    const notesDialog = ref(false);
    const editNotesValue = ref('');

    const currentNotes = computed(() => {
      // Depend on revision so UI updates when notes change
      if (props.track.revision.value === undefined) {
        return '';
      }
      const feature = props.track.features[props.track.begin];
      if (feature && feature.notes && feature.notes.length > 0) {
        return feature.notes.join(', ');
      }
      return '';
    });

    const hasNotes = computed(() => currentNotes.value.length > 0);

    const notesTooltip = computed(() => (
      hasNotes.value ? currentNotes.value : 'Add note'
    ));

    function setTrackType(type: string) {
      cameraStore.setTrackType(props.track.id, type);
    }

    function openMultiCamTools() {
      if (context.state.active !== 'MultiCamTools') {
        context.toggle('MultiCamTools');
      }
    }

    function handleClicked(event: MouseEvent) {
      const modifiers = event.ctrlKey ? { ctrl: true } : undefined;
      handler.trackSeek(props.track.trackId, modifiers);
    }

    function openNotesDialog(event: MouseEvent) {
      event.stopPropagation();
      editNotesValue.value = currentNotes.value;
      notesDialog.value = true;
    }

    function saveNotes() {
      if (readOnlyMode.value) return;
      props.track.setFeatureNotes(props.track.begin, editNotesValue.value.trim());
      notesDialog.value = false;
    }

    function cancelNotes() {
      notesDialog.value = false;
    }

    function clearNotes() {
      editNotesValue.value = '';
    }

    return {
      allTypes: trackFilters.allTypes,
      handler,
      handleClicked,
      multiCam,
      openMultiCamTools,
      readOnlyMode,
      setTrackType,
      trackFilters,
      typeStyling,
      currentNotes,
      hasNotes,
      notesTooltip,
      notesDialog,
      editNotesValue,
      openNotesDialog,
      saveNotes,
      cancelNotes,
      clearNotes,
    };
  },
});
</script>

<template>
  <div
    class="track-item d-flex flex-column align-start hover-show-parent px-1"
    :style="itemStyle"
  >
    <v-row
      class="pt-2 justify-center item-row"
      no-gutters
      align="center"
    >
      <div
        v-if="solo"
        class="type-color-box"
        :style="{ backgroundColor: color }"
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
        <span>{{ track.trackId }}</span>
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
      <v-tooltip
        open-delay="200"
        bottom
        max-width="360"
        content-class="sidebar-notes-tooltip"
      >
        <template #activator="{ on, attrs }">
          <v-btn
            v-bind="attrs"
            small
            icon
            class="ma-0"
            :color="hasNotes ? 'white' : 'grey darken-1'"
            v-on="on"
            @click="openNotesDialog"
          >
            <v-icon>
              {{ hasNotes ? 'mdi-note-text' : 'mdi-note-text-outline' }}
            </v-icon>
          </v-btn>
        </template>
        <span>{{ notesTooltip }}</span>
      </v-tooltip>
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
            :icon="feature.isKeyframe ? 'mdi-star' : 'mdi-star-outline'"
            :disabled="keyframeDisabled"
            tooltip-text="Toggle keyframe"
            @click="toggleKeyframe"
          />
          <tooltip-btn
            v-if="isTrack && !readOnlyMode"
            :icon="feature.shouldInterpolate ? 'mdi-vector-selection' : 'mdi-selection-off'"
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
        icon="mdi-pencil-box-outline"
        tooltip-text="Toggle edit mode"
        :disabled="!inputValue || readOnlyMode"
        @click="handler.trackEdit(track.trackId)"
      />
    </v-row>

    <v-dialog
      v-model="notesDialog"
      width="480"
      @click:outside="cancelNotes"
    >
      <v-card>
        <v-card-title>
          {{ readOnlyMode ? 'View note' : 'Edit note' }} — track {{ track.trackId }}
        </v-card-title>
        <v-card-text>
          <v-textarea
            v-model="editNotesValue"
            autofocus
            auto-grow
            rows="3"
            outlined
            dense
            hide-details
            :readonly="readOnlyMode"
            :placeholder="readOnlyMode ? 'No note' : 'Add a note...'"
            @keydown.ctrl.enter="saveNotes"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="!readOnlyMode"
            text
            :disabled="!editNotesValue"
            @click="clearNotes"
          >
            Clear
          </v-btn>
          <v-spacer />
          <v-btn
            text
            @click="cancelNotes"
          >
            {{ readOnlyMode ? 'Close' : 'Cancel' }}
          </v-btn>
          <v-btn
            v-if="!readOnlyMode"
            color="primary"
            @click="saveNotes"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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

<!-- Unscoped: tooltip content is teleported outside this component -->
<style lang="scss">
.v-tooltip__content.sidebar-notes-tooltip {
  opacity: 1 !important;
  background-color: #1e1e1e !important;
  color: #f5f5f5 !important;
  font-size: 14px !important;
  font-weight: 500;
  line-height: 1.45;
  letter-spacing: 0.01em;
  padding: 10px 14px !important;
  border: 1px solid #555;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
