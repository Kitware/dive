<script lang="ts">
import {
  defineComponent, reactive, computed, Ref,
} from '@vue/composition-api';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';

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
  },

  components: { TrackItem },

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
    const { frame: frameRef } = useTime();
    const multiSelectList = useMultiSelectList();
    const {
      trackSelectNext, trackSplit, removeTrack, trackAdd,
    } = useHandler();

    const data = reactive({
      itemHeight: 70, // in pixelx
      settingsActive: false,
    });

    const virtualListItems = computed(() => {
      const selectedTrackId = selectedTrackIdRef.value;
      const multiSelect = multiSelectList.value;
      const checkedTrackIds = checkedTrackIdsRef.value;
      const editingMode = editingModeRef.value;
      const allTypes = allTypesRef.value;
      return filteredTracksRef.value.map((filtered) => ({
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

    const virtualScroll = useVirtualScrollTo({
      itemHeight: data.itemHeight,
      getAnnotation,
      filteredListRef: filteredTracksRef,
      selectedIdRef: selectedTrackIdRef,
      multiSelectList,
      selectNext: trackSelectNext,
    });

    function getItemProps(item: typeof virtualListItems.value[number]) {
      const confidencePair = item.filteredTrack.annotation.getType(
        item.filteredTrack.context.confidencePairIndex,
      );
      const trackType = confidencePair[0];
      const selected = item.selectedTrackId === item.filteredTrack.annotation.id;
      return {
        trackType,
        track: item.filteredTrack.annotation,
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
            text.push(item.filteredTrack.annotation.trackId.toString());
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
      filteredTracks: filteredTracksRef,
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
    <v-subheader class="flex-grow-1 trackHeader px-2">
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
      class="tracks"
      :items="virtualListItems"
      :item-height="data.itemHeight"
      :height="virtualHeight"
      bench="1"
    >
      <template #default="{ item }">
        <track-item
          v-bind="getItemProps(item)"
          :lock-types="lockTypes"
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
.tracks {
  overflow-y: auto;
  overflow-x: hidden;

  .v-input--checkbox {
    label {
      white-space: pre-wrap;
    }
  }
}
</style>
