<script>
export default {
  name: "TrackItem",
  props: {
    track: {
      type: Object
    },
    inputValue: {
      type: Boolean
    },
    selectedTrack: {
      type: Number
    },
    editingTrack: {
      type: Number
    }
  }
};
</script>

<template>
  <div
    class="track-item d-flex align-center hover-show-parent"
    @click.self="$emit('click')"
  >
    <v-checkbox
      class="my-0 mx-3 pt-0"
      dense
      hide-details
      :input-value="inputValue"
      @change="$emit('change', $event)"
    >
    </v-checkbox>
    <div
      style="pointer-events: none;"
      :class="{
        selected: selectedTrack === track.track,
        editing: editingTrack === track.track
      }"
    >
      {{ track.track }}
    </div>
    <!-- <div>{{`${track.track}. ${track.confidencePairs
        .sort((a, b) => b[1] - a[1])
        .map(pair => pair[0])
        .join('\n')}`}}</div> -->
    <v-spacer />
    <v-menu offset-y>
      <template v-slot:activator="{ on }">
        <v-btn class="hover-show-child" icon v-on="on">
          <v-icon>
            mdi-dots-horizontal
          </v-icon>
        </v-btn>
      </template>
      <v-list>
        <v-list-item @click="$emit('goto-first-frame')">
          <v-list-item-title>Go to first frame</v-list-item-title>
        </v-list-item>
        <v-list-item @click="$emit('edit')">
          <v-list-item-title>Edit annotation</v-list-item-title>
        </v-list-item>
        <v-list-item @click="$emit('edit-meta')">
          <v-list-item-title>Edit meta</v-list-item-title>
        </v-list-item>
        <v-divider />
        <v-list-item @click="$emit('delete')">
          <v-list-item-title>Delete track</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<style lang="scss" scoped>
.track-item {
  height: 36px;
}

.selected {
  font-weight: bold;
}

.editing:after {
  content: "*";
}

.hover-show-parent {
  .hover-show-child {
    display: none;
  }
  &:hover {
    .hover-show-child {
      display: inherit;
    }
  }
}
</style>
