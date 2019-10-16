<script>
import VirtualList from "vue-virtual-scroll-list";
import { VCheckbox } from "vuetify/lib";

// A monkey patch
VirtualList.options.props.item.type = [Object, Function];

export default {
  name: "Tracks",
  components: {
    VirtualList
  },
  props: {
    tracks: {
      type: Array
    },
    selectedTracks: {
      type: Array
    }
  },
  data: function() {
    return { selectedTracks_: this.selectedTracks, item: VCheckbox };
  },
  watch: {
    selectedTracks(value) {
      this.selectedTracks_ = value;
    },
    selectedTracks_(value) {
      this.$emit("update:selectedTracks", value);
    }
  },
  methods: {
    getItemProps(itemIndex) {
      var track = this.tracks[itemIndex];
      return {
        class: "mt-3 ml-3",
        domProps: {},
        props: {
          label: `${track.track}. ${track.confidencePairs
            .sort((a, b) => b[1] - a[1])
            .map(pair => pair[0])
            .join("\n    ")}`,
          dense: true,
          hideDetails: true,
          inputValue: this.selectedTracks_.indexOf(track.track) !== -1
        },
        on: {
          change: checked => {
            if (checked) {
              this.selectedTracks_.push(track.track);
            } else {
              var index = this.selectedTracks_.indexOf(track.track);
              this.selectedTracks_.splice(index, 1);
            }
          }
        }
      };
    }
  }
};
</script>

<template>
  <div class="tracks">
    <v-subheader>Tracks</v-subheader>
    <virtual-list
      :size="28"
      :remain="15"
      :item="item"
      :itemcount="tracks.length"
      :itemprops="getItemProps"
    >
    </virtual-list>
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
