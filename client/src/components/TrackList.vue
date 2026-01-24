<script lang="ts">
import {
  defineComponent, reactive, computed, Ref, ref,
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
} from '../provides';
import useVirtualScrollTo from '../use/useVirtualScrollTo';
import TrackItem from './TrackItem.vue';

/* Magic numbers involved in height calculation */
const TrackListHeaderHeight = 52;

type SortKey = 'id' | 'start' | 'end' | 'confidence' | 'type' | 'notes';
type SortDirection = 'asc' | 'desc';

export default defineComponent({
  name: 'TrackList',

  components: { TrackItem },

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
      trackSplit, removeTrack, trackAdd, trackSelect,
    } = useHandler();

    const data = reactive({
      itemHeight: props.compact ? 50 : 70, // in pixels
      settingsActive: false,
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

        switch (sortKey.value) {
          case 'id':
            return (trackA.trackId - trackB.trackId) * direction;
          case 'start':
            return (trackA.begin - trackB.begin) * direction;
          case 'end':
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

    const newTrackColor: Ref<string> = computed(() => {
      if (props.newTrackType !== 'unknown') {
        return typeStylingRef.value.color(props.newTrackType);
      }
      // Return default color
      return '';
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
      trackSelect,
    });

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
      newTrackColor,
      filteredTracks: finalFilteredTracks,
      readOnlyMode,
      trackAdd,
      virtualHeight,
      virtualListItems,
      virtualList: virtualScroll.virtualList,
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
  <div class="d-flex flex-column">
    <!-- Compact header for bottom layout -->
    <div
      v-if="compact"
      class="compact-header d-flex flex-column px-2 py-1"
    >
      <div class="d-flex align-center">
        <span class="compact-header-text">Tracks ({{ filteredTracks.length }})</span>
        <v-spacer />
        <v-menu
          v-model="data.settingsActive"
          :close-on-content-click="false"
          :nudge-bottom="28"
        >
          <template #activator="{ on, attrs }">
            <v-btn
              icon
              x-small
              class="mr-2"
              v-bind="attrs"
              v-on="on"
            >
              <v-icon
                x-small
                :color="data.settingsActive ? 'accent' : 'default'"
              >
                mdi-cog
              </v-icon>
            </v-btn>
          </template>
          <slot
            v-if="data.settingsActive"
            name="settings"
          />
        </v-menu>
        <v-tooltip
          open-delay="100"
          bottom
        >
          <template #activator="{ on }">
            <v-btn
              :disabled="filteredTracks.length === 0 || readOnlyMode"
              icon
              x-small
              class="mr-2"
              v-on="on"
              @click="multiDelete()"
            >
              <v-icon
                x-small
                color="error"
              >
                mdi-delete
              </v-icon>
            </v-btn>
          </template>
          <span>Delete visible items</span>
        </v-tooltip>
        <v-tooltip
          open-delay="200"
          bottom
          max-width="200"
        >
          <template #activator="{ on }">
            <v-btn
              :disabled="readOnlyMode"
              outlined
              x-small
              :color="newTrackColor"
              v-on="on"
              @click="trackAdd()"
            >
              <v-icon x-small>
                mdi-plus
              </v-icon>
            </v-btn>
          </template>
          <span>Add {{ newTrackMode }} ({{ newTrackType }})</span>
        </v-tooltip>
      </div>
      <!-- Column headers row -->
      <div class="compact-column-headers d-flex align-center px-1 mt-1">
        <span class="col-spacer" />
        <span
          class="col-header col-id sortable"
          :class="{ active: sortKey === 'id' }"
          @click="handleSort('id')"
        >
          ID
          <v-icon
            v-if="sortIcon('id')"
            x-small
          >{{ sortIcon('id') }}</v-icon>
        </span>
        <span
          class="col-header col-type sortable"
          :class="{ active: sortKey === 'type' }"
          @click="handleSort('type')"
        >
          Type
          <v-icon
            v-if="sortIcon('type')"
            x-small
          >{{ sortIcon('type') }}</v-icon>
        </span>
        <span
          class="col-header col-conf sortable"
          :class="{ active: sortKey === 'confidence' }"
          @click="handleSort('confidence')"
        >
          Conf
          <v-icon
            v-if="sortIcon('confidence')"
            x-small
          >{{ sortIcon('confidence') }}</v-icon>
        </span>
        <span
          class="col-header col-start sortable"
          :class="{ active: sortKey === 'start' }"
          @click="handleSort('start')"
        >
          Start
          <v-icon
            v-if="sortIcon('start')"
            x-small
          >{{ sortIcon('start') }}</v-icon>
        </span>
        <span
          class="col-header col-end sortable"
          :class="{ active: sortKey === 'end' }"
          @click="handleSort('end')"
        >
          End
          <v-icon
            v-if="sortIcon('end')"
            x-small
          >{{ sortIcon('end') }}</v-icon>
        </span>
        <span
          class="col-header col-notes sortable"
          :class="{ active: sortKey === 'notes' }"
          @click="handleSort('notes')"
        >
          Notes
          <v-icon
            v-if="sortIcon('notes')"
            x-small
          >{{ sortIcon('notes') }}</v-icon>
        </span>
        <v-spacer />
        <span class="col-header col-actions">Actions</span>
      </div>
    </div>
    <!-- Standard header -->
    <v-subheader
      v-else
      class="flex-grow-1 trackHeader px-2"
    >
      <v-container class="py-2">
        <v-row align="center">
          Tracks ({{ filteredTracks.length }})
          <v-spacer />
          <v-menu
            v-model="data.settingsActive"
            :close-on-content-click="false"
            :nudge-bottom="28"
          >
            <template #activator="{ on, attrs }">
              <v-btn
                icon
                small
                class="mr-2"
                v-bind="attrs"
                v-on="on"
              >
                <v-icon
                  small
                  :color="data.settingsActive ? 'accent' : 'default'"
                >
                  mdi-cog
                </v-icon>
              </v-btn>
            </template>
            <slot
              v-if="data.settingsActive"
              name="settings"
            />
          </v-menu>
          <v-tooltip
            open-delay="100"
            bottom
          >
            <template #activator="{ on }">
              <v-btn
                :disabled="filteredTracks.length === 0 || readOnlyMode"
                icon
                small
                class="mr-2"
                v-on="on"
                @click="multiDelete()"
              >
                <v-icon
                  small
                  color="error"
                >
                  mdi-delete
                </v-icon>
              </v-btn>
            </template>
            <span>Delete visible items</span>
          </v-tooltip>
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-btn
                :disabled="readOnlyMode"
                outlined
                x-small
                class="mr-2"
                :color="newTrackColor"
                v-on="on"
                @click="trackAdd()"
              >
                <v-icon small>
                  mdi-plus
                </v-icon>
                {{ newTrackMode }}
              </v-btn>
            </template>
            <span>Default Type: {{ newTrackType }}</span>
          </v-tooltip>
        </v-row>
      </v-container>
    </v-subheader>
    <datalist id="allTypesOptions">
      <option
        v-for="type in allTypes"
        :key="type"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist>
    <v-virtual-scroll
      ref="virtualList"
      v-mousetrap="mouseTrap"
      :class="compact ? 'tracks-compact' : 'tracks'"
      :items="virtualListItems"
      :item-height="data.itemHeight"
      :height="virtualHeight"
      bench="1"
    >
      <template #default="{ item }">
        <track-item
          v-bind="getItemProps(item)"
          :lock-types="lockTypes"
          :disabled="disabled"
          :compact="compact"
          @seek="$emit('track-seek', $event)"
        />
      </template>
    </v-virtual-scroll>
  </div>
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
</style>
