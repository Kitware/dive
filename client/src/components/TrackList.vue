<script lang="ts">
import Vue from 'vue';
import {
  defineComponent, reactive, computed, ref, Ref, watch,
} from '@vue/composition-api';
import TrackItem from 'vue-media-annotator/components/TrackItem.vue';
import Track, { TrackId } from 'vue-media-annotator/track';
import {
  useAllTypes,
  useCheckedTrackIds,
  useEditingMode,
  useSelectedTrackId,
  useTrackMap,
  useTracks,
  useTypeStyling,
} from 'vue-media-annotator/provides';

interface VirtualListItem {
  track: Track;
  selectedTrackId: number | null;
  checkedTrackIds: readonly number[];
  editingTrack: boolean;
  allTypes: readonly string[];
}

export default defineComponent({
  props: {
    newTrackMode: {
      type: String,
      required: true,
    },
    newTrackType: {
      type: String,
      required: true,
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

  setup(props, { emit }) {
    const allTypesRef = useAllTypes();
    const checkedTrackIdsRef = useCheckedTrackIds();
    const editingModeRef = useEditingMode();
    const selectedTrackIdRef = useSelectedTrackId();
    const trackMap = useTrackMap();
    const tracksRef = useTracks();
    const typeStylingRef = useTypeStyling();

    const data = reactive({
      itemHeight: 70, // in pixelx
      settingsActive: false,
    });
    const virtualList = ref(null as null | Vue);

    const virtualListItems: Ref<readonly VirtualListItem[]> = computed(() => {
      const selectedTrackId = selectedTrackIdRef.value;
      const checkedTrackIds = checkedTrackIdsRef.value;
      const editingMode = editingModeRef.value;
      const allTypes = allTypesRef.value;
      return tracksRef.value.map((track) => ({
        track,
        selectedTrackId,
        checkedTrackIds,
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

    function scrollToTrack(trackId: TrackId | null): void {
      if (trackId !== null && virtualList.value !== null) {
        const track = trackMap.get(trackId);
        if (track) {
          const offset = tracksRef.value.indexOf(track);
          if (offset === -1) {
            virtualList.value.$el.scrollTop = 0;
          } else {
            // try to show the selected track as the third track in the list
            virtualList.value.$el.scrollTop = (offset * data.itemHeight) - (2 * data.itemHeight);
          }
        }
      }
    }

    function scrollToSelectedTrack(): void {
      Vue.nextTick(() => scrollToTrack(selectedTrackIdRef.value));
    }

    function scrollPreventDefault(
      element: HTMLElement,
      keyEvent: KeyboardEvent,
      direction: 'up' | 'down',
    ): void {
      if (virtualList.value !== null && element === virtualList.value.$el) {
        if (direction === 'up') {
          emit('track-previous');
        } else if (direction === 'down') {
          emit('track-next');
        }
        keyEvent.preventDefault();
      }
    }

    function getItemProps(item: VirtualListItem) {
      const type = item.track.getType();
      const trackType = type ? type[0] : '';
      const selected = item.selectedTrackId === item.track.trackId;
      return {
        trackType,
        track: item.track,
        inputValue: item.checkedTrackIds.indexOf(item.track.trackId) >= 0,
        selected,
        editing: selected && item.editingTrack,
        color: typeStylingRef.value.color(trackType),
        types: item.allTypes,
      };
    }

    watch(selectedTrackIdRef, scrollToTrack);
    watch(tracksRef, scrollToSelectedTrack);

    const mouseTrap = computed(() => {
      const disabled = props.hotkeysDisabled;
      return [
        {
          bind: 'up',
          handler: (el: HTMLElement, event: KeyboardEvent) => {
            scrollPreventDefault(el, event, 'up');
          },
          disabled,
        },
        {
          bind: 'down',
          handler: (el: HTMLElement, event: KeyboardEvent) => {
            scrollPreventDefault(el, event, 'down');
          },
          disabled,
        },
        {
          bind: 'enter',
          handler: () => {
            if (selectedTrackIdRef.value !== null) {
              emit('track-click', selectedTrackIdRef.value);
            }
          },
          disabled,
        },
        {
          bind: 'del',
          handler: () => {
            if (selectedTrackIdRef.value !== null) {
              emit('track-remove', selectedTrackIdRef.value);
            }
          },
          disabled,
        },
        {
          bind: 'x',
          handler: () => emit('track-split', selectedTrackIdRef.value),
          disabled,
        },
      ];
    });

    return {
      allTypes: allTypesRef,
      data,
      getItemProps,
      mouseTrap,
      newTrackColor,
      tracks: tracksRef,
      virtualListItems,
      virtualList,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-subheader class="flex-grow-1 trackHeader">
      <v-container>
        <v-row align="center">
          Tracks ({{ tracks.length }})
          <v-spacer />
          <div>
            <v-btn
              icon
              small
              class="mr-2"
              @click="data.settingsActive = !data.settingsActive"
            >
              <v-icon
                small
                :color="data.settingsActive ? 'accent' : 'default'"
              >
                mdi-settings
              </v-icon>
            </v-btn>
            <v-tooltip
              open-delay="200"
              bottom
              max-width="200"
            >
              <template #activator="{ on }">
                <v-btn
                  outlined
                  x-small
                  :color="newTrackColor"
                  v-on="on"
                  @click="$emit('track-add')"
                >
                  <v-icon small>
                    mdi-plus
                  </v-icon>
                  {{ newTrackMode }}
                </v-btn>
              </template>
              <span>Default Type: {{ newTrackType }}</span>
            </v-tooltip>
          </div>
        </v-row>
        <v-row>
          <v-expand-transition>
            <slot
              v-if="data.settingsActive"
              name="settings"
            />
          </v-expand-transition>
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
      :height="height"
      bench="1"
    >
      <template #default="{ item }">
        <track-item
          v-bind="getItemProps(item)"
          @change="$emit('track-checked', { trackId: item.track.trackId, value: $event })"
          @type-change="$emit('track-type-change', { trackId: item.track.trackId, value: $event })"
          @delete="$emit('track-remove', item.track.trackId)"
          @click="$emit('track-click', item.track.trackId)"
          @edit="$emit('track-edit', item.track.trackId)"
          @split="$emit('track-split', item.track.trackId)"
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
