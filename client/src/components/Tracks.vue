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
      selectedOffset: 0,
    };
  },
  watch: {
    selectedTrackId() {
      this.calculateOffset();
    },
    checkedTracks(value) {
      this.checkedTracks_ = value;
      /* This is done because after creating a new track checkedTracks are edited.
         A new track is selected and created before detection, so just watching
         selectedTrackId won't cover all cases.
      */
      this.calculateOffset();
    },
    checkedTracks_(value) {
      this.$emit('update:checkedTracks', value);
    },
  },
  methods: {
    getSelectedTrack() {
      return this.tracks.find((track) => track.trackId === this.selectedTrackId);
    },
    /**
     * Used to calculate the scroll position of the virtual scroll list for the currently
     * selected item.  It will center the item if it can on the scroll list.
     * Called when either selectedTrackId updates or checkedTracks updates
     */
    calculateOffset() {
      let offset = this.tracks.map((item) => item.trackId).indexOf(this.selectedTrackId);
      if (offset === -1) {
        offset = 0;
      } else {
        offset -= Math.floor(this.visibleItems / 2);
      }
      this.selectedOffset = offset;
    },
    /**
     * For up/down we prevent the window from scrolling and use the calculated offset instead
     * @param {HTMLElement} element element which is the caller for the mouse event
     * @param {KeyboardEvent} keyEvent Event used to prevent default keyboard scrolling behavior
     * @param {('up' | 'down')} direction  determine if the user is moving up or down in the list
     */
    scrollPreventDefault(element, keyEvent, direction) {
      // eslint-disable-next-line no-console
      console.log(keyEvent);
      if (element === this.$refs.virtualList.$el) {
        if (direction === 'up') {
          this.$emit('select-track-up');
        } else if (direction === 'down') {
          this.$emit('select-track-down');
        }
        keyEvent.preventDefault();
      }
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
      ref="virtualList"
      v-mousetrap="[
        { bind: 'del', handler: () => $emit('delete-track', getSelectedTrack()) },
        { bind: 'up', handler: (el, event) => scrollPreventDefault(el, event, 'up') },
        { bind: 'down', handler: (el, event) => scrollPreventDefault(el, event, 'down') },
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
