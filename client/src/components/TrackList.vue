<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import TrackItem from '@/components/TrackItem.vue';
import Track, { TrackId } from '@/lib/track';

export default Vue.extend({
  name: 'TrackList',

  components: {
    TrackItem,
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
    typeColorMapper: {
      type: Function as PropType<(t: string) => string>,
      required: true,
    },
  },

  data: () => ({
    itemHeight: 45, // in pixels
  }),

  computed: {
    virtualListItems() {
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
  },

  watch: {
    // eslint-disable-next-line func-names
    'selectedTrackId.value': function (trackId) {
      this.scrollToTrack(trackId);
    },
    // eslint-disable-next-line func-names
    'filteredTrackIds.value': function () {
      this.$nextTick(() => this.scrollToTrack(this.selectedTrackId.value));
    },
  },


  methods: {
    scrollToTrack(trackId: TrackId) {
      const virtualList = (this.$refs.virtualList as Vue).$el;
      const offset = this.filteredTrackIds.value.indexOf(trackId);
      if (offset === -1) {
        virtualList.scrollTop = 0;
      } else {
        // try to show the selected track as the third track in the list
        virtualList.scrollTop = (offset * this.itemHeight) - (2 * this.itemHeight);
      }
    },

    scrollPreventDefault(element: HTMLElement, keyEvent: KeyboardEvent, direction: 'up' | 'down') {
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
      return {
        trackType: track.getType() || '',
        trackId,
        inputValue: checkedTrackIds.indexOf(trackId) >= 0,
        selected: selectedTrackId === trackId,
        editingTrack,
        colorMap: this.typeColorMapper,
        types: allTypes,
      };
    },

    setType(trackId: TrackId, newType: string) {
      const track = this.trackMap.get(trackId);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${trackId}`);
      }
      track.setType(newType);
    },
  },
});
</script>

<template>
  <div class="tracks">
    <v-subheader>
      Tracks ({{ filteredTrackIds.value.length }})
      <v-spacer />
      <v-btn
        icon
        @click="$emit('track-add')"
      >
        <v-icon>mdi-plus</v-icon>
      </v-btn>
    </v-subheader>
    <v-virtual-scroll
      ref="virtualList"
      v-mousetrap="[
        { bind: 'up', handler: (el, event) => scrollPreventDefault(el, event, 'up') },
        { bind: 'down', handler: (el, event) => scrollPreventDefault(el, event, 'down') },
        { bind: 'enter', handler: () => $emit('track-click', selectedTrackId.value)},
        { bind: 'del', handler: () => $emit('track-remove', selectedTrackId.value)},
      ]"
      :items="virtualListItems"
      :item-height="itemHeight"
      :height="400"
    >
      <template #default="{ item }">
        <track-item
          v-bind="getItemProps(item)"
          @change="$emit('track-checked', { trackId: item.trackId, value: $event })"
          @type-change="setType(item.trackId, $event)"
          @delete="$emit('track-remove', item.trackId)"
          @click="$emit('track-click', item.trackId)"
          @edit="$emit('track-edit', item.trackId)"
        />
      </template>
    </v-virtual-scroll>
  </div>
</template>

<style lang="scss">
.strcoller {
  height: 100%;
}
.tracks {
  overflow-y: auto;

  .v-input--checkbox {
    label {
      white-space: pre-wrap;
    }
  }
}
</style>
