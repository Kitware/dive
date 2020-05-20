<script lang="ts">
// TODO p2
// Why did I have to eslint disable all these
// eslint-disable-next-line no-unused-vars
import Vue, { PropType } from 'vue';
// eslint-disable-next-line no-unused-vars
import { Ref } from '@vue/composition-api';
// TODO p2 write shims or ignore
// @ts-ignore
import VirtualList from 'vue-virtual-scroll-list';
import TrackItem from '@/components/TrackItem.vue';
// eslint-disable-next-line no-unused-vars
import Track from '@/lib/track';

export default Vue.extend({
  name: 'TrackList',

  components: { VirtualList },

  /*
   * Note the distinction between refs and non-refs
   * If this compoent needs reactivity, it must use
   * the `.value` of a ref
   */
  props: {
    trackMap: {
      type: Map as PropType<Map<string, Track>>,
      required: true,
    },
    filteredTrackIds: {
      type: Object as PropType<Ref<Array<string>>>,
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
      type: Object as PropType<Ref<Array<string>>>,
      required: true,
    },
    selectedTrackId: {
      type: Object as PropType<Ref<string>>,
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

  data() {
    return {
      TrackItem,
      visibleItems: 9,
      selectedOffset: 0,
    };
  },

  methods: {
    onRender() {
      console.error('onRENDER TRACKLIST');
      return true;
    },
    /**
     * Used to calculate the scroll position of the virtual scroll list for the currently
     * selected item.  It will center the item if it can on the scroll list.
     * Called when either selectedTrackId updates or checkedTracks updates
     */
    // calculateOffset() {
    //   let offset = this.tracks.map((item) => item.trackId).indexOf(this.selectedTrackId);
    //   if (offset === -1) {
    //     offset = 0;
    //   } else {
    //     offset -= Math.floor(this.visibleItems / 2);
    //   }
    //   this.selectedOffset = offset;
    // },
    /**
     * For up/down we prevent the window from scrolling and use the calculated offset instead
     * @param {HTMLElement} element element which is the caller for the mouse event
     * @param {KeyboardEvent} keyEvent Event used to prevent default keyboard scrolling behavior
     * @param {('up' | 'down')} direction  determine if the user is moving up or down in the list
     */
    // scrollPreventDefault(element, keyEvent, direction) {
    //   if (element === this.$refs.virtualList.$el) {
    //     if (direction === 'up') {
    //       this.$emit('select-track-up');
    //     } else if (direction === 'down') {
    //       this.$emit('select-track-down');
    //     }
    //     keyEvent.preventDefault();
    //   }
    // },
    // TODO p2: our usage of virtual-scroll-list is way out of date, the API
    // has completely changed. Update how we're using it.
    // it also looks like they've removed the ability to intercept events....
    // maybe look at `vue-virtual-scroller` library instead.
    getItemProps(itemIndex: number) {
      if (itemIndex === 0) {
        console.error('getItemPrps', itemIndex);
      }
      // TODO p2
      // By avoiding any `value` access in this function,
      // we could prevent re-render on the entire list
      // and have higher precision to update a single list item
      const trackId = this.filteredTrackIds.value[itemIndex];
      const track = this.trackMap.get(trackId)!;
      return {
        props: {
          track,
          /* InputValue is the value of the checkbox */
          inputValue: this.checkedTrackIds.value.indexOf(trackId) >= 0,
          selectedTrackId: this.selectedTrackId.value,
          editingTrack: this.editingTrack.value,
          colorMap: this.typeColorMapper,
          types: this.allTypes.value,
        },
        on: {
          change: (value: boolean) => {
            this.$emit('track-checked', {
              trackId: track.trackId.value,
              value,
            });
          },
          'type-change': (type: string) => {
            track.setType(type);
          },
          delete: () => {
            this.$emit('track-remove', track.trackId.value);
          },
          click: () => {
            this.$emit('track-click', track.trackId.value);
          },
          edit: () => {
            this.$emit('track-edit', track.trackId.value);
          },
        },
      };
    },
  },
});
</script>

<template>
  <div class="tracks">
    <v-subheader>
      Tracks
      <v-spacer />
      <v-btn
        icon
        @click="$emit('track-add')"
      >
        <v-icon>mdi-plus</v-icon>
      </v-btn>
    </v-subheader>
    <virtual-list
      v-if="onRender()"
      ref="virtualList"
      v-mousetrap="[
        { bind: 'del', handler: () => $emit('track-remove', selectedTrackId.value) },
        { bind: 'up', handler: (el, event) => scrollPreventDefault(el, event, 'up') },
        { bind: 'down', handler: (el, event) => scrollPreventDefault(el, event, 'down') },
        { bind: 'enter', handler: () => $emit('track-click', getSelectedTrack()) }
      ]"
      :size="45"
      :remain="9"
      :start="selectedOffset"
      :item="TrackItem"
      :itemcount="filteredTrackIds.value.length"
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
