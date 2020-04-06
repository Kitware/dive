<script>
export default {
  name: 'TrackItem',
  props: {
    track: {
      type: Object,
    },
    types: {
      type: Array,
    },
    inputValue: {
      type: Boolean,
    },
    selectedTrack: {
      type: Number,
    },
    editingTrack: {
      type: Number,
    },
  },
  data: () => ({
    editing: false,
  }),
  watch: {
    track() {
      this.editing = false;
    },
  },
};
</script>

<template>
  <div
    class="track-item d-flex align-center hover-show-parent px-1"
    :class="{
      selected: selectedTrack === track.trackId
    }"
    @click.self="$emit('click')"
  >
    <v-checkbox
      class="my-0 ml-1 pt-0"
      dense
      hide-details
      :input-value="inputValue"
      color="neutral"
      @change="$emit('change', $event)"
    />
    <div>
      {{ track.trackId + (editingTrack === track.trackId ? "*" : "") }}
    </div>
    <div
      v-if="!editing"
      class="type-display flex-grow-1 flex-shrink-1 ml-2"
      @click="editing = true"
    >
      {{
        track.confidencePairs.length ? track.confidencePairs[0][0] : "undefined"
      }}
    </div>
    <v-combobox
      v-else
      class="ml-2"
      :value="track.confidencePairs.length ? track.confidencePairs[0][0] : ''"
      :items="types"
      dense
      hide-details
      @change="$emit('type-change', $event)"
    />
    <v-menu offset-y>
      <template v-slot:activator="{ on }">
        <v-btn
          class="hover-show-child"
          icon
          v-on="on"
        >
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
  height: 45px;

  .type-display {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.selected {
  font-weight: bold;
  background-color: var(--v-accent-base);
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
