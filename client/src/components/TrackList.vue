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

    const filterDetectionsByFrame = ref(clientSettings.trackSettings.trackListSettings.filterDetectionsByFrame);
    watch(
      () => clientSettings.trackSettings.trackListSettings.filterDetectionsByFrame,
      (newValue) => {
        filterDetectionsByFrame.value = newValue;
      },
    );

    const finalFilteredTracks = computed(() => {
      if (filterDetectionsByFrame.value && !isPlaying.value) {
        return filteredTracksRef.value.filter((track) => {
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
      return filteredTracksRef.value;
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
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <!-- Compact header for bottom layout -->
    <div
      v-if="compact"
      class="compact-header d-flex align-center px-2 py-1"
    >
      <span class="compact-header-text">Tracks ({{ filteredTracks.length }})</span>
      <v-spacer />
      <v-tooltip
        open-delay="100"
        bottom
      >
        <template #activator="{ on }">
          <v-btn
            :disabled="filteredTracks.length === 0 || readOnlyMode"
            icon
            x-small
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
  font-size: 12px;
  font-weight: 500;
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
