<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import TrackItem from '@/components/TrackItem.vue';
import CreationMode from '@/components/CreationMode.vue';
import Track, { TrackId } from '@/lib/track';
import { NewTrackSettings } from '@/use/useSettings';
import { cloneDeep } from 'lodash';

interface VirtualListItem {
  track: Track;
  selectedTrackId: number;
  checkedTrackIds: number[];
  editingTrack: boolean;
  allTypes: string[];
}

export default Vue.extend({
  name: 'TrackList',

  components: {
    TrackItem,
    CreationMode,
  },

  props: {
    trackMap: {
      type: Map as PropType<Map<TrackId, Track>>,
      required: true,
    },
    filteredTracks: {
      type: Object as PropType<Ref<Track[]>>,
      required: true,
    },
    allTypes: {
      type: Object as PropType<Ref<Array<string>>>,
      required: true,
    },
    checkedTypes: {
      type: Object as PropType<Ref<Array<string>>>,
      required: true,
    },
    checkedTrackIds: {
      type: Object as PropType<Ref<Array<TrackId>>>,
      required: true,
    },
    selectedTrackId: {
      type: Object as PropType<Ref<TrackId>>,
      required: true,
    },
    editingTrack: {
      type: Object as PropType<Ref<boolean>>,
      required: true,
    },
    frame: {
      type: Object as PropType<Ref<number>>,
      required: true,
    },
    typeStyling: {
      type: Object as PropType<Ref<{ color: (t: string) => string }>>,
      required: true,
    },
    newTrackSettings: {
      type: Object as PropType<Ref<NewTrackSettings>>,
      default: null,
    },
  },

  data: () => ({
    itemHeight: 70, // in pixels
    settingsActive: false,
  }),

  computed: {
    virtualListItems(): VirtualListItem[] {
      const selectedTrackId = this.selectedTrackId.value;
      const checkedTrackIds = this.checkedTrackIds.value;
      const editingTrack = this.editingTrack.value;
      const allTypes = this.allTypes.value;
      return this.filteredTracks.value.map((track) => ({
        track,
        selectedTrackId,
        checkedTrackIds,
        editingTrack,
        allTypes,
      }));
    },

    newTrackColor(): string {
      if (this.newTrackSettings && this.newTrackSettings.value.type !== 'unknown') {
        return this.typeStyling.value.color(this.newTrackSettings.value.type);
      }
      // Return default color
      return '';
    },
  },

  watch: {
    'allTypes.value': 'checkExistingTrack',
    // because Vue typescript definitions are broke and don't recognize
    // the `this` context inside watcher handers
    'selectedTrackId.value': 'scrollToTrack',
    'filteredTracks.value': 'scrollToSelectedTrack',
  },


  methods: {
    /**
     * On load check allTypes to make sure it exists in the overall list if not default to unknown
     * All changes should have a created type after initial load.
     * Has the additional benefit if you delete the only newTrackSettings.type
     * It will default back to the unknown type instead of creating a type that isn't known
     */
    checkExistingTrack(types: string[]) {
      if (types.indexOf(this.newTrackSettings.value.type) === -1) {
        const copy: NewTrackSettings = cloneDeep(this.newTrackSettings.value);
        copy.type = 'unknown'; // Modify the value
        this.$emit('update-new-track-settings', copy);
      }
    },
    scrollToTrack(trackId: TrackId): void {
      const virtualList = (this.$refs.virtualList as Vue).$el;
      const track = this.trackMap.get(trackId);
      if (track) {
        const offset = this.filteredTracks.value.indexOf(track);
        if (offset === -1) {
          virtualList.scrollTop = 0;
        } else {
          // try to show the selected track as the third track in the list
          virtualList.scrollTop = (offset * this.itemHeight) - (2 * this.itemHeight);
        }
      }
    },

    scrollToSelectedTrack(): void {
      this.$nextTick(() => this.scrollToTrack(this.selectedTrackId.value));
    },

    scrollPreventDefault(element: HTMLElement, keyEvent: KeyboardEvent, direction: 'up' | 'down'): void {
      if (element === (this.$refs.virtualList as Vue).$el) {
        if (direction === 'up') {
          this.$emit('track-previous');
        } else if (direction === 'down') {
          this.$emit('track-next');
        }
        keyEvent.preventDefault();
      }
    },

    getItemProps(item: VirtualListItem) {
      const type = item.track.getType();
      const trackType = type ? type[0] : '';
      const selected = item.selectedTrackId === item.track.trackId;
      return {
        trackType,
        track: item.track,
        inputValue: item.checkedTrackIds.indexOf(item.track.trackId) >= 0,
        selected,
        editing: selected && item.editingTrack,
        color: this.typeStyling.value.color(trackType),
        types: item.allTypes,
        frame: this.frame,
      };
    },
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-subheader class="flex-grow-1 trackHeader">
      <v-container>
        <v-row align="center">
          Tracks ({{ filteredTracks.value.length }})
          <v-spacer />
          <v-btn
            v-if="!newTrackSettings"
            outlined
            x-small
            @click="$emit('track-add')"
          >
            <v-icon small>
              mdi-plus
            </v-icon>
          </v-btn>
          <div
            v-else
            class="newTrackSettings"
          >
            <v-btn
              icon
              small
              class="ml-2"
              @click="settingsActive = !settingsActive"
            >
              <v-icon
                small
                :color="settingsActive ? 'accent' : 'default'"
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
                  {{ newTrackSettings.value.mode }}
                </v-btn>
              </template>
              <span>Default Type: {{ newTrackSettings.value.type }}</span>
            </v-tooltip>
          </div>
        </v-row>
        <v-row>
          <v-expand-transition>
            <creation-mode
              v-if="settingsActive"
              :all-types="allTypes"
              :new-track-settings="newTrackSettings"
              @update-new-track-settings="$emit('update-new-track-settings',$event)"
            />
          </v-expand-transition>
        </v-row>
      </v-container>
    </v-subheader>
    <datalist id="allTypesOptions">
      <option
        v-for="type in allTypes.value"
        :key="type"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist>
    <v-virtual-scroll
      ref="virtualList"
      v-mousetrap="[
        { bind: 'up', handler: (el, event) => scrollPreventDefault(el, event, 'up'),
          disabled: $prompt.visible() },
        { bind: 'down', handler: (el, event) => scrollPreventDefault(el, event, 'down'),
          disabled: $prompt.visible() },
        { bind: 'enter', handler: () => $emit('track-click', selectedTrackId.value),
          disabled: $prompt.visible()},
        { bind: 'del', handler: () =>
            selectedTrackId.value !== null && $emit('track-remove', selectedTrackId.value),
          disabled: $prompt.visible()},
        { bind: 'x', handler: () => $emit('track-split', selectedTrackId.value),
          disabled: $prompt.visible()}
      ]"
      class="tracks"
      :items="virtualListItems"
      :item-height="itemHeight"
      :height="420"
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
