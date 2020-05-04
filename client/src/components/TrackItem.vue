<script>
import { stringNumberNullValidator } from '@/utils';

export default {
  name: 'TrackItem',
  props: {
    track: {
      type: Object,
      required: true,
    },
    types: {
      type: Array,
      required: true,
    },
    inputValue: {
      type: Boolean,
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
  data: () => ({
    editing: false,
  }),
  computed: {
    /**
     * Sets styling for the selected track
     * Sets the background accent color to have a slight
     * opacity so it isn't overwhelming
     */
    style() {
      if (this.selectedTrackId === this.track.trackId) {
        return {
          'font-weight': 'bold',
          'background-color': `${this.$vuetify.theme.themes.dark.accent}aa`,
        };
      }
      return {};
    },
  },
  watch: {
    track() {
      this.editing = false;
    },
    /**
     * When editing is enabled through Keyboard Shortcut this will provide focus
     * and open the menu so the use can choose an item with the keyboard
     * nextTick is used because the ref isn't rendered until editing is true
     */
    editing(val) {
      if (val) {
        this.$nextTick(() => {
          this.$refs.trackTypeBox.focus();
          this.$refs.trackTypeBox.activateMenu();
        });
      }
    },
  },
  methods: {
    focusType() {
      if (this.selectedTrackId === this.track.trackId) {
        this.editing = true;
      }
    },
  },
};
</script>

<template>
  <div
    class="track-item d-flex align-center hover-show-parent px-1"

    :style="style"
  >
    <v-checkbox
      class="my-0 ml-1 pt-0"
      dense
      hide-details
      :input-value="inputValue"
      :color="colorMap(track.confidencePairs.length ? track.confidencePairs[0][0] : '')"
      @change="$emit('change', $event)"
    />
    <div
      class="trackNumber"
      @click.self="$emit('click')"
    >
      {{ track.trackId + (editingTrackId === track.trackId ? "*" : "") }}
    </div>
    <div
      v-if="!editing"
      v-mousetrap="[
        { bind: 'shift+enter', handler: focusType },
      ]"
      class="type-display flex-grow-1 flex-shrink-1 ml-2"
      @click="editing = true"
    >
      {{
        track.confidencePairs.length ? track.confidencePairs[0][0] : "undefined"
      }}
    </div>
    <v-combobox
      v-else
      ref="trackTypeBox"
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
  .trackNumber{
    &:hover {
      cursor: pointer;
      font-weight: bolder;
    }
}
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
