<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import TrackItem from '@/components/TrackItem.vue';
import CreationMode from '@/components/CreationMode.vue';
import Track, { TrackId } from '@/lib/track';
import { NewTrackSettings } from '@/use/useSettings';

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
    filteredTrackIds: {
      type: Object as PropType<Ref<Array<TrackId>>>,
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
    virtualListItems(): {
      trackId: number;
      selectedTrackId: number;
      checkedTrackIds: number[];
      editingTrack: boolean;
      allTypes: string[];
    }[] {
      const selectedTrackId = this.selectedTrackId.value;
      const checkedTrackIds = this.checkedTrackIds.value;
      const editingTrack = this.editingTrack.value;
      const allTypes = this.allTypes.value;
      return this.filteredTrackIds.value.map((trackId) => ({
        trackId,
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
    // because Vue typescript definitions are broke and don't recognize
    // the `this` context inside watcher handers
    'selectedTrackId.value': 'scrollToTrack',
    'filteredTrackIds.value': 'scrollToSelectedTrack',
  },


  methods: {
    scrollToTrack(trackId: TrackId): void {
      const virtualList = (this.$refs.virtualList as Vue).$el;
      const offset = this.filteredTrackIds.value.indexOf(trackId);
      if (offset === -1) {
        virtualList.scrollTop = 0;
      } else {
        // try to show the selected track as the third track in the list
        virtualList.scrollTop = (offset * this.itemHeight) - (2 * this.itemHeight);
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
    getItemProps({
      trackId,
      selectedTrackId,
      checkedTrackIds,
      editingTrack,
      allTypes,
    }: {
      trackId: TrackId;
      selectedTrackId: TrackId;
      checkedTrackIds: TrackId[];
      editingTrack: boolean;
      allTypes: string[];
    }) {
      const track = this.trackMap.get(trackId);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${trackId}`);
      }
      const type = track.getType();
      const trackType = type ? type[0] : '';
      const selected = selectedTrackId === trackId;
      return {
        trackType,
        track,
        inputValue: checkedTrackIds.indexOf(trackId) >= 0,
        selected,
        editing: selected && this.editingTrack.value,
        color: this.typeStyling.value.color(trackType),
        types: allTypes,
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
          Tracks ({{ filteredTrackIds.value.length }})
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
                  {{ newTrackSettings.value.mode }}<v-icon small>
                    mdi-plus
                  </v-icon>
                </v-btn>
              </template>
              <span>Default Type: {{ newTrackSettings.value.type }}</span>
            </v-tooltip>
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
          @change="$emit('track-checked', { trackId: item.trackId, value: $event })"
          @type-change="$emit('track-type-change', { trackId: item.trackId, value: $event })"
          @delete="$emit('track-remove', item.trackId)"
          @click="$emit('track-click', item.trackId)"
          @edit="$emit('track-edit', item.trackId)"
          @split="$emit('track-split', item.trackId)"
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
