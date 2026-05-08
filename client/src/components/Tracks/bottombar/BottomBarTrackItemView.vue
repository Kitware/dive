<script lang="ts">
import {
  computed, defineComponent, nextTick, PropType, ref, watch,
} from 'vue';
import { ColumnVisibilitySettings } from 'dive-common/store/settings';
import TooltipBtn from '../../TooltipButton.vue';
import {
  useCameraStore,
  useHandler,
  useReadOnlyMode,
  useTrackFilters,
} from '../../../provides';
import Track from '../../../track';

export default defineComponent({
  name: 'BottomBarTrackItemView',
  components: { TooltipBtn },
  props: {
    track: { type: Object as PropType<Track>, required: true },
    trackType: { type: String, required: true },
    itemStyle: { type: Object, required: true },
    color: { type: String, required: true },
    lockTypes: { type: Boolean, default: false },
    columnVisibility: { type: Object as PropType<ColumnVisibilitySettings>, default: null },
    fps: { type: Number, default: null },
    editing: { type: Boolean, required: true },
    inputValue: { type: Boolean, required: true },
    merging: { type: Boolean, default: false },
    toggleKeyframe: { type: Function as PropType<() => void>, required: true },
    toggleInterpolation: { type: Function as PropType<() => void>, required: true },
    toggleAllInterpolation: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const handler = useHandler();
    const readOnlyMode = useReadOnlyMode();
    const allTypes = useTrackFilters().allTypes;
    const cameraStore = useCameraStore();

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
    const editingAttributeKey = ref<string | null>(null);
    const editAttributeValue = ref('');
    const attributeInputRef = ref<HTMLInputElement | null>(null);
    const localAttributeDisplay = ref<Record<string, string>>({});

    watch(() => props.track.id, () => {
      localNotesDisplay.value = '';
      localAttributeDisplay.value = {};
      editingAttributeKey.value = null;
    });

    const topConfidence = computed(() => {
      if (props.track.revision.value !== undefined
          && props.track.confidencePairs
          && props.track.confidencePairs.length > 0) {
        return props.track.confidencePairs[0][1];
      }
      return null;
    });

    const currentNotes = computed(() => {
      if (localNotesDisplay.value) {
        return localNotesDisplay.value;
      }
      if (props.track.revision.value !== undefined) {
        const feature = props.track.features[props.track.begin];
        if (feature && feature.notes && feature.notes.length > 0) {
          return feature.notes.join(', ');
        }
      }
      return '';
    });

    const formatTimestamp = (frame: number) => {
      if (!props.fps || props.fps <= 0) return '';
      const totalSeconds = frame / props.fps;
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const ms = Math.floor((totalSeconds % 1) * 1000);
      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
      return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0').slice(0, 2)}`;
    };

    const startTimestamp = computed(() => formatTimestamp(props.track.begin));
    const endTimestamp = computed(() => formatTimestamp(props.track.end));

    const trackAttributeColumns = computed(
      () => (props.columnVisibility?.attributeColumns || []).filter((key: string) => key.startsWith('track_')),
    );

    function getAttributeValue(attrKey: string) {
      if (localAttributeDisplay.value[attrKey]) {
        return localAttributeDisplay.value[attrKey];
      }

      if (props.track.revision.value === undefined) return '';

      if (attrKey.startsWith('track_')) {
        const name = attrKey.replace('track_', '');
        const val = props.track.attributes[name];
        if (val !== undefined && val !== null) {
          return String(val);
        }
      }

      if (attrKey.startsWith('detection_')) {
        const name = attrKey.replace('detection_', '');
        const feature = props.track.features[props.track.begin];
        if (feature && feature.attributes) {
          const val = feature.attributes[name];
          if (val !== undefined && val !== null) {
            return String(val);
          }
        }
      }
      return '';
    }

    function handleClicked(event: MouseEvent) {
      const modifiers = event.ctrlKey ? { ctrl: true } : undefined;
      handler.trackSeek(props.track.trackId, modifiers);
    }

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
      props.track.setFeatureNotes(props.track.begin, newNotes);
      localNotesDisplay.value = newNotes;
      editingNotes.value = false;
    }

    function cancelEditNotes() {
      editingNotes.value = false;
    }

    function startEditAttribute(attrKey: string, event: MouseEvent) {
      if (readOnlyMode.value) return;
      event.stopPropagation();
      editAttributeValue.value = getAttributeValue(attrKey);
      editingAttributeKey.value = attrKey;
      nextTick(() => {
        attributeInputRef.value?.focus();
        attributeInputRef.value?.select();
      });
    }

    function saveAttribute() {
      const attrKey = editingAttributeKey.value;
      if (!attrKey) return;

      const newValue = editAttributeValue.value.trim();
      const isTrackAttr = attrKey.startsWith('track_');
      const actualKey = attrKey.replace(/^(track_|detection_)/, '');

      if (isTrackAttr) {
        props.track.setAttribute(actualKey, newValue || undefined);
      } else {
        props.track.setFeatureAttribute(props.track.begin, actualKey, newValue || undefined);
      }

      localAttributeDisplay.value[attrKey] = newValue;
      editingAttributeKey.value = null;
    }

    function cancelEditAttribute() {
      editingAttributeKey.value = null;
    }

    function setEditTypeValue(value: string) {
      editTypeValue.value = value;
    }

    function setEditConfidenceValue(value: string) {
      editConfidenceValue.value = value;
    }

    function setEditNotesValue(value: string) {
      editNotesValue.value = value;
    }

    function setEditAttributeValue(value: string) {
      editAttributeValue.value = value;
    }

    return {
      allTypes,
      attributeInputRef,
      cancelEditAttribute,
      cancelEditConfidence,
      cancelEditNotes,
      cancelEditType,
      confidenceInputRef,
      currentNotes,
      editAttributeValue,
      editConfidenceValue,
      editingAttributeKey,
      editingConfidence,
      editingNotes,
      editingType,
      editNotesValue,
      editTypeValue,
      endTimestamp,
      getAttributeValue,
      handleClicked,
      handler,
      notesInputRef,
      readOnlyMode,
      saveAttribute,
      saveConfidence,
      saveNotes,
      saveType,
      setEditAttributeValue,
      setEditConfidenceValue,
      setEditNotesValue,
      setEditTypeValue,
      startEditAttribute,
      startEditConfidence,
      startEditNotes,
      startEditType,
      startTimestamp,
      topConfidence,
      trackAttributeColumns,
      typeInputRef,
    };
  },
  methods: {
    handleTypeSelectInput(event: Event) {
      const target = event.target as HTMLSelectElement | null;
      this.setEditTypeValue(target?.value ?? '');
    },
    handleTypeTextInput(event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.setEditTypeValue(target?.value ?? '');
    },
    handleConfidenceInput(event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.setEditConfidenceValue(target?.value ?? '');
    },
    handleAttributeInput(event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.setEditAttributeValue(target?.value ?? '');
    },
    handleNotesInput(event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.setEditNotesValue(target?.value ?? '');
    },
  },
});
</script>

<template>
  <div
    class="track-item-compact d-flex align-center hover-show-parent px-1"
    :style="itemStyle"
    @click="handleClicked"
  >
    <div
      class="type-color-box-compact"
      :style="{ backgroundColor: color }"
    />
    <div class="trackNumber-compact">
      {{ track.trackId }}
    </div>
    <template v-if="!columnVisibility || columnVisibility.type !== false">
      <select
        v-if="editingType && lockTypes"
        ref="typeInputRef"
        :value="editTypeValue"
        class="compact-type-input compact-select-input"
        @blur="saveType"
        @input="handleTypeSelectInput"
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
        :value="editTypeValue"
        type="text"
        list="allTypesOptions"
        class="compact-type-input"
        @input="handleTypeTextInput"
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
    </template>
    <template v-if="!columnVisibility || columnVisibility.confidence !== false">
      <input
        v-if="editingConfidence"
        ref="confidenceInputRef"
        :value="editConfidenceValue"
        type="number"
        step="0.01"
        min="0"
        max="1"
        class="compact-confidence-input"
        @input="handleConfidenceInput"
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
    </template>
    <span
      v-if="!columnVisibility || columnVisibility.startFrame"
      class="track-frame-start clickable"
      @click.stop="$emit('seek', track.begin)"
    >{{ track.begin }}</span>
    <span
      v-if="!columnVisibility || columnVisibility.endFrame"
      class="track-frame-end clickable"
      @click.stop="$emit('seek', track.end)"
    >{{ track.end }}</span>
    <span
      v-if="columnVisibility?.startTimestamp"
      class="track-timestamp clickable"
      @click.stop="$emit('seek', track.begin)"
    >{{ startTimestamp }}</span>
    <span
      v-if="columnVisibility?.endTimestamp"
      class="track-timestamp clickable"
      @click.stop="$emit('seek', track.end)"
    >{{ endTimestamp }}</span>
    <template v-for="attrKey in trackAttributeColumns">
      <input
        v-if="editingAttributeKey === attrKey"
        :key="attrKey + '-input'"
        ref="attributeInputRef"
        :value="editAttributeValue"
        type="text"
        class="compact-attribute-input"
        @input="handleAttributeInput"
        @blur="saveAttribute"
        @keydown.enter="saveAttribute"
        @keydown.escape="cancelEditAttribute"
        @click.stop
      >
      <span
        v-else
        :key="attrKey"
        class="track-attribute text-truncate"
        :class="{ editable: !readOnlyMode }"
        @click="startEditAttribute(attrKey, $event)"
      >{{ getAttributeValue(attrKey) || '-' }}</span>
    </template>
    <template v-if="!columnVisibility || columnVisibility.notes">
      <input
        v-if="editingNotes"
        ref="notesInputRef"
        :value="editNotesValue"
        type="text"
        class="compact-notes-input"
        placeholder="Add notes..."
        @input="handleNotesInput"
        @blur="saveNotes"
        @keydown.enter="saveNotes"
        @keydown.escape="cancelEditNotes"
        @click.stop
      >
      <div
        v-else
        class="track-notes-wrapper"
      >
        <span
          class="track-notes-edit-zone"
          :class="{ editable: !readOnlyMode }"
          @click="startEditNotes"
        />
        <span
          class="track-notes-compact text-truncate"
          :class="{ 'has-notes': currentNotes }"
        >{{ currentNotes || '...' }}</span>
      </div>
    </template>
    <v-spacer />
    <div class="compact-actions d-flex">
      <tooltip-btn
        v-if="!merging"
        icon="mdi-pencil-box-outline"
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
</template>

<style lang="scss" scoped>
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
    font-size: 14px;
    font-weight: bold;
    margin-right: 8px;
    min-width: 30px;
  }

  .track-frame-start,
  .track-frame-end {
    font-size: 14px;
    color: #888;
    min-width: 45px;
    flex-shrink: 0;
    text-align: right;

    &.clickable {
      cursor: pointer;
      &:hover {
        color: #80c6e8;
        text-decoration: underline;
      }
    }
  }

  .track-frame-end {
    margin-right: 8px;
  }

  .track-timestamp {
    font-size: 12px;
    color: #888;
    min-width: 70px;
    flex-shrink: 0;
    text-align: right;
    margin-right: 8px;

    &.clickable {
      cursor: pointer;
      &:hover {
        color: #80c6e8;
        text-decoration: underline;
      }
    }
  }

  .track-attribute {
    font-size: 12px;
    color: #888;
    min-width: 60px;
    max-width: 100px;
    flex-shrink: 0;
    text-align: left;
    margin-right: 8px;

    &.editable {
      cursor: text;
      &:hover {
        color: #fff;
        text-decoration: underline;
      }
    }
  }

  .compact-attribute-input {
    font-size: 12px;
    min-width: 60px;
    max-width: 100px;
    flex-shrink: 0;
    background-color: #333;
    border: 1px solid #666;
    border-radius: 3px;
    color: #fff;
    padding: 1px 4px;
    margin-right: 8px;
    outline: none;
  }

  .track-notes-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 60px;
    max-width: 200px;
    margin-left: 12px;
  }

  .track-notes-edit-zone {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 33%;
    min-width: 20px;
    max-width: 60px;
    z-index: 1;

    &.editable {
      cursor: text;
      &:hover ~ .track-notes-compact {
        color: #fff;
        text-decoration: underline;
      }
    }
  }

  .track-notes-compact {
    font-size: 14px;
    color: #666;
    flex-grow: 1;
    padding: 1px 4px;
    pointer-events: none;

    &.has-notes {
      color: #aaa;
    }
  }

  .compact-notes-input {
    font-size: 14px;
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
  }

  .track-type-compact {
    font-size: 14px;
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
    font-size: 14px;
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

  .compact-type-input,
  .compact-confidence-input {
    font-size: 14px;
    background-color: #333;
    border: 1px solid #666;
    border-radius: 3px;
    color: #fff;
    padding: 1px 4px;
    outline: none;
  }

  .compact-type-input {
    width: 80px;
    min-width: 80px;
    flex-shrink: 0;
  }

  .compact-select-input {
    appearance: menulist;
  }

  .compact-confidence-input {
    width: 54px;
    min-width: 54px;
    flex-shrink: 0;
    text-align: right;
    -moz-appearance: textfield;
  }

  .compact-actions {
    flex-shrink: 0;
  }
}
</style>
