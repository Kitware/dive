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
  },
  data() {
    return { checkedTracks_: this.checkedTracks, item: TrackItem };
  },
  computed: {
    selectedOffset() {
      return this.tracks.map((item) => item.trackId).indexOf(this.selectedTrackId);
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
    getItemProps(itemIndex) {
      const track = this.tracks[itemIndex];
      return {
        props: {
          track,
          inputValue: this.checkedTracks_.indexOf(track.trackId) !== -1,
          selectedTrackId: this.selectedTrackId,
          editingTrackId: this.editingTrackId,
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
            this.$emit('click-track', track);
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
