<script>
export default {
  name: "Tracks",
  props: {
    tracks: {
      type: Array
    },
    selectedTracks: {
      type: Array
    }
  },
  data: function() {
    return { selectedTracks_: this.selectedTracks };
  },
  watch: {
    selectedTracks(value) {
      this.selectedTracks_ = value;
    },
    selectedTracks_(value) {
      this.$emit("update:selectedTracks", value);
    }
  }
};
</script>

<template>
  <div class="tracks">
    <v-subheader>Tracks</v-subheader>
      <v-checkbox
        class="mt-3 ml-3"
        v-for="track of tracks" :key="track.track"
        v-model="selectedTracks_"
        :value="track.track"
        :title="
          track.confidencePairs
            .sort((a, b) => b[1] - a[1])
            .map(pair => pair[0])
            .join(', ')
        "
        :label="
          `${track.track}. ${track.confidencePairs
            .sort((a, b) => b[1] - a[1])
            .map(pair => pair[0])
            .join('\n    ')}`
        "
        dense
        hide-details
      ></v-checkbox>
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
