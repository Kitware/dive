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

  watch: {
    // eslint-disable-next-line func-names
    'selectedTrackId.value': function (trackId) {
      this.scrollToTrack(trackId);
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
          this.$emit('select-track-up');
        } else if (direction === 'down') {
          this.$emit('select-track-down');
        }
        keyEvent.preventDefault();
      }
    },

    getItemProps(trackId: TrackId) {
      const track = this.trackMap.get(trackId);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${trackId}`);
      }
      return {
        track,
        trackId,
        inputValue: this.checkedTrackIds.value.indexOf(trackId) >= 0,
        selected: this.selectedTrackId.value === trackId,
        editingTrack: this.editingTrack.value,
        colorMap: this.typeColorMapper,
        types: this.allTypes.value,
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
      Tracks
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
      ]"
      :items="filteredTrackIds.value"
      :item-height="itemHeight"
      :height="400"
    >
      <template #default="{ item: trackId }">
        <track-item
          v-bind="getItemProps(trackId)"
          @change="$emit('track-checked', { trackId, value: $event })"
          @type-change="setType(trackId, $event)"
          @delete="$emit('track-remove', trackId)"
          @click="$emit('track-click', trackId)"
          @edit="$emit('track-edit', trackId)"
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
