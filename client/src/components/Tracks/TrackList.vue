<script lang="ts">
import Vue, {
  defineComponent, reactive, computed, ref,
  watch,
} from 'vue';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';

import { clientSettings } from 'dive-common/store/settings';
import {
  useEditingMode,
  useHandler,
  useSelectedTrackId,
  useTrackFilters,
  useTime,
  useReadOnlyMode,
  useTrackStyleManager,
  useMultiSelectList,
  useCameraStore,
} from '../../provides';
import useVirtualScrollTo from '../../use/useVirtualScrollTo';
import SideBarTrackListView from './sidebar/SideBarTrackListView.vue';
import BottomBarTrackListView from './bottombar/BottomBarTrackListView.vue';

/* Magic numbers involved in height calculation */
const TrackListHeaderHeight = 52;

type SortKey = 'id' | 'start' | 'end' | 'startTime' | 'endTime' | 'confidence' | 'type' | 'notes' | string;
type SortDirection = 'asc' | 'desc';

export default defineComponent({
  name: 'TrackList',

  components: {
    SideBarTrackListView,
    BottomBarTrackListView,
  },

  props: {
    newTrackMode: {
      type: String,
      required: true,
    },
    newTrackType: {
      type: String,
      required: true,
    },
    lockTypes: {
      type: Boolean,
      default: false,
    },
    hotkeysDisabled: {
      type: Boolean,
      required: true,
    },
    height: {
      type: Number,
      default: 420,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    compact: {
      type: Boolean,
      default: false,
    },
    fps: {
      type: Number,
      default: null,
    },
  },

  setup(props) {
    const { prompt } = usePrompt();
    const readOnlyMode = useReadOnlyMode();
    const trackFilters = useTrackFilters();
    const allTypesRef = trackFilters.allTypes;
    const checkedTrackIdsRef = trackFilters.checkedIDs;
    const editingModeRef = useEditingMode();
    const selectedTrackIdRef = useSelectedTrackId();
    const cameraStore = useCameraStore();
    const filteredTracksRef = trackFilters.filteredAnnotations;
    const typeStylingRef = useTrackStyleManager().typeStyling;
    const { frame: frameRef, isPlaying } = useTime();
    const multiSelectList = useMultiSelectList();
    const {
      trackSplit, removeTrack, trackAdd, trackSelect, trackSelectNext,
    } = useHandler();

    const data = reactive({
      itemHeight: props.compact ? 50 : 70, // in pixels
      settingsActive: false,
      columnSettingsActive: false,
    });

    const sortKey = ref<SortKey>('id');
    const sortDirection = ref<SortDirection>('asc');

    const filterDetectionsByFrame = ref(clientSettings.trackSettings.trackListSettings.filterDetectionsByFrame);
    watch(
      () => clientSettings.trackSettings.trackListSettings.filterDetectionsByFrame,
      (newValue) => {
        filterDetectionsByFrame.value = newValue;
      },
    );

    const finalFilteredTracks = computed(() => {
      let tracks = filteredTracksRef.value;
      if (filterDetectionsByFrame.value && !isPlaying.value) {
        tracks = tracks.filter((track) => {
          const possibleTrack = cameraStore.getAnyPossibleTrack(track.annotation.id);
          if (possibleTrack) {
            const [feature] = possibleTrack.getFeature(frameRef.value);
            if (feature && feature.keyframe) {
              return true;
            }
          }
          return false;
        });
      }

      // Helper to get notes from a track's first keyframe
      function getTrackNotes(track: ReturnType<typeof cameraStore.getTracksMerged>): string {
        // Try direct access first (most common case)
        const directFeature = track.features[track.begin];
        if (directFeature && directFeature.notes && directFeature.notes.length > 0) {
          return directFeature.notes.join(', ');
        }
        // If no feature at begin or no notes, try to get the first available feature
        const [real, lower, upper] = track.getFeature(track.begin);
        const fallbackFeature = real || lower || upper;
        if (fallbackFeature && fallbackFeature.notes && fallbackFeature.notes.length > 0) {
          return fallbackFeature.notes.join(', ');
        }
        return '';
      }

      // Helper to get attribute value from a track
      function getTrackAttributeValue(
        track: ReturnType<typeof cameraStore.getTracksMerged>,
        attrKey: string,
      ): string | number | undefined {
        // Check if it's a track attribute (track_*) or detection attribute (detection_*)
        const isTrackAttr = attrKey.startsWith('track_');
        const actualKey = attrKey.replace(/^(track_|detection_)/, '');

        if (isTrackAttr) {
          // Track-level attribute
          if (track.attributes && track.attributes[actualKey] !== undefined) {
            return track.attributes[actualKey] as string | number;
          }
        } else {
          // Detection-level attribute - get from first keyframe
          const feature = track.features[track.begin];
          if (feature && feature.attributes && feature.attributes[actualKey] !== undefined) {
            return feature.attributes[actualKey] as string | number;
          }
        }
        return undefined;
      }

      // Apply sorting
      const sorted = [...tracks];
      const direction = sortDirection.value === 'asc' ? 1 : -1;

      sorted.sort((a, b) => {
        let trackA;
        let trackB;
        try {
          trackA = cameraStore.getTracksMerged(a.annotation.id);
          trackB = cameraStore.getTracksMerged(b.annotation.id);
        } catch {
          return 0;
        }

        const key = sortKey.value;

        // Check if sorting by an attribute column
        if (key.startsWith('track_') || key.startsWith('detection_')) {
          const valA = getTrackAttributeValue(trackA, key);
          const valB = getTrackAttributeValue(trackB, key);
          const emptyA = valA === undefined || valA === '';
          const emptyB = valB === undefined || valB === '';
          // Empty values go last in ascending, first in descending
          if (emptyA && !emptyB) return direction;
          if (!emptyA && emptyB) return -direction;
          if (emptyA && emptyB) return 0;
          // Numeric comparison if both are numbers
          if (typeof valA === 'number' && typeof valB === 'number') {
            return (valA - valB) * direction;
          }
          // String comparison otherwise
          return String(valA).localeCompare(String(valB)) * direction;
        }

        switch (key) {
          case 'id':
            return (trackA.trackId - trackB.trackId) * direction;
          case 'start':
          case 'startTime':
            return (trackA.begin - trackB.begin) * direction;
          case 'end':
          case 'endTime':
            return (trackA.end - trackB.end) * direction;
          case 'confidence': {
            const confA = trackA.confidencePairs?.[0]?.[1] ?? 0;
            const confB = trackB.confidencePairs?.[0]?.[1] ?? 0;
            return (confA - confB) * direction;
          }
          case 'type': {
            const typeA = trackA.getType(a.context.confidencePairIndex)[0];
            const typeB = trackB.getType(b.context.confidencePairIndex)[0];
            const typeCompare = typeA.localeCompare(typeB);
            if (typeCompare !== 0) return typeCompare * direction;
            // Secondary sort by confidence within same type
            const confA = trackA.confidencePairs?.[0]?.[1] ?? 0;
            const confB = trackB.confidencePairs?.[0]?.[1] ?? 0;
            return (confA - confB) * direction;
          }
          case 'notes': {
            const notesA = getTrackNotes(trackA);
            const notesB = getTrackNotes(trackB);
            const emptyA = notesA === '';
            const emptyB = notesB === '';
            // Empty notes go last in ascending, first in descending
            if (emptyA && !emptyB) return direction;
            if (!emptyA && emptyB) return -direction;
            if (emptyA && emptyB) return 0;
            return notesA.localeCompare(notesB) * direction;
          }
          default:
            return 0;
        }
      });
      return sorted;
    });

    const virtualListItems = computed(() => {
      const selectedTrackId = selectedTrackIdRef.value;
      const multiSelect = multiSelectList.value;
      const checkedTrackIds = checkedTrackIdsRef.value;
      const editingMode = editingModeRef.value;
      const allTypes = allTypesRef.value;
      return finalFilteredTracks.value.map((filtered) => ({
        filteredTrack: filtered,
        selectedTrackId,
        checkedTrackIds,
        multiSelect,
        editingTrack: !!editingMode,
        allTypes,
      }));
    });

    const getAnnotation = (id: AnnotationId) => cameraStore.getAnyPossibleTrack(id);

    watch(
      () => filteredTracksRef.value,
      (newValue) => {
        if (newValue.length === 0) {
          trackSelect(null, false);
        }
      },
    );

    const virtualScroll = useVirtualScrollTo({
      itemHeight: data.itemHeight,
      getAnnotation,
      filteredListRef: finalFilteredTracks,
      selectedIdRef: selectedTrackIdRef,
      multiSelectList,
      selectNext: (delta) => trackSelectNext(
        delta,
        finalFilteredTracks.value.map((filtered) => filtered.annotation),
      ),
    });

    /** Template refs cannot be passed as props (Vue unwraps them to null). */
    function setVirtualListRef(instance: Vue | null): void {
      virtualScroll.virtualList.value = instance;
    }

    function getItemProps(item: typeof virtualListItems.value[number]) {
      const confidencePair = item.filteredTrack.annotation.getType(
        item.filteredTrack.context.confidencePairIndex,
      );
      const trackType = confidencePair;
      const selected = item.selectedTrackId === item.filteredTrack.annotation.id;
      const track = cameraStore.getTracksMerged(item.filteredTrack.annotation.id);
      return {
        trackType,
        track,
        inputValue: item.checkedTrackIds.includes(item.filteredTrack.annotation.id),
        selected,
        secondarySelected: item.multiSelect.includes(item.filteredTrack.annotation.id),
        editing: selected && item.editingTrack,
        color: typeStylingRef.value.color(trackType),
        types: item.allTypes,
      };
    }

    async function multiDelete() {
      const tracksDisplayed: number[] = [];
      const text = ['Do you want to delete the following tracks:'];
      let count = 0;
      const limit = 20;
      virtualListItems.value.forEach((item) => {
        if (item.checkedTrackIds.includes(item.filteredTrack.annotation.id)) {
          if (count < limit) {
            text.push(item.filteredTrack.annotation.id.toString());
          }
          tracksDisplayed.push(item.filteredTrack.annotation.id);
          count += 1;
        }
      });
      if (count >= limit) {
        text.push(`And ${count - limit} more tracks...`);
      }

      const result = await prompt({
        title: 'Confirm',
        text,
        confirm: true,
      });
      if (result) {
        removeTrack(tracksDisplayed, true);
      }
    }

    const mouseTrap = computed(() => {
      const disabled = props.hotkeysDisabled;
      return [
        {
          bind: 'up',
          handler: (el: HTMLElement, event: KeyboardEvent) => {
            virtualScroll.scrollPreventDefault(el, event, 'up');
          },
          disabled,
        },
        {
          bind: 'down',
          handler: (el: HTMLElement, event: KeyboardEvent) => {
            virtualScroll.scrollPreventDefault(el, event, 'down');
          },
          disabled,
        },
        {
          bind: 'del',
          handler: () => {
            if (!readOnlyMode.value && selectedTrackIdRef.value !== null) {
              removeTrack([selectedTrackIdRef.value]);
            }
          },
          disabled,
        },
        {
          bind: 'x',
          handler: () => !readOnlyMode.value
          && trackSplit(selectedTrackIdRef.value, frameRef.value),
          disabled,
        },
      ];
    });

    const virtualHeight = computed(() => props.height - TrackListHeaderHeight);

    function handleSort(key: SortKey) {
      if (sortKey.value === key) {
        // Toggle direction between desc and asc
        sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc';
      } else {
        // New sort key starts with descending
        sortKey.value = key;
        sortDirection.value = 'desc';
      }
    }

    const sortIcon = computed(() => (key: SortKey) => {
      if (sortKey.value !== key) return '';
      return sortDirection.value === 'asc' ? 'mdi-chevron-up' : 'mdi-chevron-down';
    });

    return {
      allTypes: allTypesRef,
      data,
      getItemProps,
      mouseTrap,
      filteredTracks: finalFilteredTracks,
      trackAdd,
      virtualHeight,
      virtualListItems,
      setVirtualListRef,
      multiDelete,
      sortKey,
      sortDirection,
      handleSort,
      sortIcon,
    };
  },
});
</script>

<template>
  <bottom-bar-track-list-view
    v-if="compact"
    :data="data"
    :filtered-tracks="filteredTracks"
    :new-track-mode="newTrackMode"
    :new-track-type="newTrackType"
    :track-add="trackAdd"
    :multi-delete="multiDelete"
    :virtual-list-items="virtualListItems"
    :get-item-props="getItemProps"
    :lock-types="lockTypes"
    :disabled="disabled"
    :fps="fps"
    :set-virtual-list-ref="setVirtualListRef"
    :mouse-trap="mouseTrap"
    :virtual-height="virtualHeight"
    :sort-key="sortKey"
    :handle-sort="handleSort"
    :sort-icon="sortIcon"
    @track-seek="$emit('track-seek', $event)"
  >
    <template #settings>
      <slot name="settings" />
    </template>
    <template #column-settings>
      <slot name="column-settings" />
    </template>
    <template #header-trailing>
      <slot name="header-trailing" />
    </template>
  </bottom-bar-track-list-view>
  <side-bar-track-list-view
    v-else
    :data="data"
    :filtered-tracks="filteredTracks"
    :new-track-mode="newTrackMode"
    :new-track-type="newTrackType"
    :track-add="trackAdd"
    :multi-delete="multiDelete"
    :virtual-list-items="virtualListItems"
    :get-item-props="getItemProps"
    :lock-types="lockTypes"
    :disabled="disabled"
    :fps="fps"
    :set-virtual-list-ref="setVirtualListRef"
    :mouse-trap="mouseTrap"
    :virtual-height="virtualHeight"
    @track-seek="$emit('track-seek', $event)"
  >
    <template #settings>
      <slot name="settings" />
    </template>
  </side-bar-track-list-view>
</template>

<style lang="scss">
.strcoller {
  height: 100%;
}
.trackHeader{
  height: auto;
}
.compact-header {
  background-color: #262626;
  border-bottom: 1px solid #444;
  flex-shrink: 0;
  min-height: 28px;
}
.compact-header-text {
  font-size: 14px;
  font-weight: 600;
}
.compact-column-headers {
  .col-header {
    font-size: 10px;
    color: #888;
    text-transform: uppercase;
    font-weight: 500;

    &.sortable {
      cursor: pointer;
      user-select: none;

      &:hover {
        color: #fff;
      }

      &.active {
        color: #80c6e8;
      }

      .v-icon {
        vertical-align: middle;
        margin-left: 1px;
      }
    }
  }
  .col-spacer {
    /* Matches color box: 10px + 6px margin */
    min-width: 16px;
  }
  .col-id {
    /* Matches trackNumber-compact: 30px + 8px margin */
    min-width: 38px;
  }
  .col-type {
    /* Matches track-type-compact: 80px */
    min-width: 80px;
  }
  .col-conf {
    /* Matches track-confidence-compact: 40px + 8px margin */
    min-width: 48px;
    text-align: center;
  }
  .col-start {
    /* Matches track-frame-start: 45px */
    min-width: 45px;
    text-align: right;
  }
  .col-end {
    /* Matches track-frame-end: 45px + 8px margin */
    min-width: 45px;
    text-align: right;
    margin-right: 8px;
  }
  .col-timestamp {
    min-width: 70px;
    text-align: right;
    margin-right: 8px;
  }
  .col-attribute {
    min-width: 60px;
    max-width: 100px;
    text-align: left;
    margin-right: 8px;
  }
  .col-notes {
    flex-grow: 1;
    min-width: 60px;
    margin-left: 12px;
  }
  .col-actions {
    min-width: 100px;
    text-align: right;
  }
}
.tracks {
  overflow-y: auto;
  overflow-x: hidden;

  .v-input--checkbox {
    label {
      white-space: pre-wrap;
    }
  }
}

.tracks-compact {
  overflow-y: scroll;
  overflow-x: hidden;

  /* Always show scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: #1e1e1e;
  }
  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: #666;
  }
}

/* Above timeline current-frame bar (z-index: 10) */
.track-settings-menu-content {
  z-index: 999;
}
</style>
