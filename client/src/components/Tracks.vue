<script>
import VirtualList from 'vue-virtual-scroll-list';
import TrackItem from '@/components/TrackItem.vue';
import { stringNumberNullValidator } from '@/utils';
// A monkey patch
VirtualList.options.props.item.type = [Object, Function];

export default {
  name: 'Tracks',
  components: {
    VirtualList,
  },
  props: {
    tracks: {
      type: Array,
      required: true,
    },
    types: {
      type: Array,
      required: true,
    },
    checkedTracks: {
      type: Array,
      required: true,
    },
    selectedTrackId: {
      validator: stringNumberNullValidator,
      required: true,
    },
    editingTrackId: {
      validator: stringNumberNullValidator,
      required: true,
    },
    colorMap: {
      type: Function,
      required: true,
    },
  },
  data() {
    return {
      checkedTracks_: this.checkedTracks,
      item: TrackItem,
      visibleItems: 9,
    };
  },
  computed: {
    /**
     * Computes the offset for displaying the item on the screen
     * When selecting from track list or elswehere we want to try
     * to center the item in the list.
     * When iterating through using the keyboard we keep it at the bottom once they
     * get above the list size
     */
    selectedOffset() {
      let offset = this.tracks.map((item) => item.trackId).indexOf(this.selectedTrackId);
      if (offset === -1) {
        offset = this.tracks.length - 1;
      } else {
        offset -= Math.floor(this.visibleItems / 2);
      }
      return offset;
    },
  },
  watch: {
    checkedTracks(value) {
      this.checkedTracks_ = value;
    },
    checkedTracks_(value) {
      this.$emit('update:checkedTracks', value);
    },
  },
  methods: {
    getSelectedTrack() {
      return this.tracks.find((track) => track.trackId === this.selectedTrackId);
    },
    getItemProps(itemIndex) {
      const track = this.tracks[itemIndex];
      return {
        props: {
          track,
          inputValue: this.checkedTracks_.indexOf(track.trackId) !== -1,
          selectedTrackId: this.selectedTrackId,
          editingTrackId: this.editingTrackId,
          colorMap: this.colorMap,
          types: this.types,
        },
        on: {
          change: (checked) => {
            if (checked) {
              this.checkedTracks_.push(track.trackId);
            } else {
              const index = this.checkedTracks_.indexOf(track.trackId);
              this.checkedTracks_.splice(index, 1);
            }
          },
          'type-change': (type) => {
            this.$emit('track-type-change', track, type);
          },
          'goto-first-frame': () => {
            this.$emit('goto-track-first-frame', track);
          },
          delete: () => {
            this.$emit('delete-track', track);
          },
          click: () => {
            this.$emit('click-track', track.trackId);
            this.$emit('goto-track-first-frame', track);
          },
          edit: () => {
            this.$emit('edit-track', track);
          },
        },
      };
    },
  },
};
</script>

<template>
  <div class="tracks">
    <v-subheader>
      Tracks<v-spacer /><v-btn
        icon
        @click="$emit('add-track')"
      >
        <v-icon>mdi-plus</v-icon>
      </v-btn>
    </v-subheader>
    <virtual-list
      v-mousetrap="[
        { bind: 'del', handler: () => $emit('delete-track', getSelectedTrack()) },
        { bind: 'up', handler: () => $emit('select-track-up') },
        { bind: 'down', handler: () => $emit('select-track-down') },
        { bind: 'enter', handler: () => $emit('goto-track-first-frame', getSelectedTrack()) }
      ]"
      :size="45"
      :remain="9"
      :start="selectedOffset"
      :item="item"
      :itemcount="tracks.length"
      :itemprops="getItemProps"
    />
  </div>
</template>

<style lang="scss">
.tracks {
  overflow-y: auto;
  padding: 4px 0;

  .v-input--checkbox {
    label {
      white-space: pre-wrap;
    }
  }
}
</style>
