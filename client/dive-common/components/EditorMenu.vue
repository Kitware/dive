<script lang="ts">
import { flatten } from 'lodash';
import Vue, { PropType } from 'vue';

import { Mousetrap } from 'vue-media-annotator/types';
import { EditAnnotationTypes, VisibleAnnotationTypes } from 'vue-media-annotator/layers';
import Recipe from 'vue-media-annotator/recipe';

interface ButtonData {
  id: string;
  icon: string;
  type?: VisibleAnnotationTypes;
  active: boolean;
  mousetrap?: Mousetrap[];
  click: () => void;
}

export default Vue.extend({
  name: 'EditorMenu',
  props: {
    editingTrack: {
      type: Boolean,
      required: true,
    },
    visibleModes: {
      type: Array as PropType<(VisibleAnnotationTypes)[]>,
      required: true,
    },
    editingMode: {
      type: [String, Boolean] as PropType<false | EditAnnotationTypes>,
      required: true,
    },
    editingDetails: {
      type: String as PropType<'disabled' | 'Creating' | 'Editing'>,
      required: true,
    },
    recipes: {
      type: Array as PropType<Recipe[]>,
      required: true,
    },
    multiSelectActive: {
      type: Boolean,
      default: false,
    },
    groupEditActive: {
      type: Boolean,
      default: false,
    },
    tailSettings: {
      type: Object as PropType<{ before: number; after: number }>,
      default: () => ({ before: 20, after: 10 }),
    },
  },
  data() {
    return {
      toolTipForce: false,
      toolTimeTimeout: 0,
      modeToolTips: {
        Creating: {
          rectangle: 'Drag to draw rectangle. Press ESC to exit.',
          Polygon: 'Click to place vertices. Right click to close.',
          LineString: 'Click to place head/tail points.',
        },
        Editing: {
          rectangle: 'Drag vertices to resize the rectangle',
          Polygon: 'Drag midpoints to create new vertices. Click vertices to select for deletion.',
          LineString: 'Click endpoints to select for deletion.',
        },
      },
    };
  },
  computed: {
    editButtons(): ButtonData[] {
      const em = this.editingMode;
      return [
        {
          id: 'rectangle',
          icon: 'mdi-vector-square',
          active: this.editingTrack && em === 'rectangle',
          mousetrap: [{
            bind: '1',
            handler: () => {
              this.$emit('set-annotation-state', { editing: 'rectangle' });
            },
          }],
          click: () => {
            this.$emit('set-annotation-state', { editing: 'rectangle' });
          },
        },
        /* Include recipes as editing modes if they're toggleable */
        ...this.recipes.filter((r) => r.toggleable.value).map((r, i) => ({
          id: r.name,
          icon: r.icon.value || 'mdi-pencil',
          active: this.editingTrack && r.active.value,
          click: () => r.activate(),
          mousetrap: [
            {
              bind: (i + 2).toString(),
              handler: () => r.activate(),
            },
            ...r.mousetrap(),
          ],
        })),
      ];
    },
    viewButtons(): ButtonData[] {
      /* Only geometry primitives can be visible types right now */
      return [
        {
          id: 'rectangle',
          type: 'rectangle',
          icon: 'mdi-vector-square',
          active: this.isVisible('rectangle'),
          click: () => this.toggleVisible('rectangle'),
        },
        {
          id: 'Polygon',
          type: 'Polygon',
          icon: 'mdi-vector-polygon',
          active: this.isVisible('Polygon'),
          click: () => this.toggleVisible('Polygon'),
        },
        {
          id: 'LineString',
          type: 'LineString',
          active: this.isVisible('LineString'),
          icon: 'mdi-vector-line',
          click: () => this.toggleVisible('LineString'),
        },
        {
          id: 'text',
          type: 'text',
          active: this.isVisible('text'),
          icon: 'mdi-format-text',
          click: () => this.toggleVisible('text'),
        },
        {
          id: 'tooltip',
          type: 'tooltip',
          active: this.isVisible('tooltip'),
          icon: 'mdi-tooltip-text-outline',
          click: () => this.toggleVisible('tooltip'),
        },
      ];
    },
    mousetrap(): Mousetrap[] {
      return flatten(this.editButtons.map((b) => b.mousetrap || []));
    },
    editingHeader() {
      if (this.groupEditActive) {
        return { text: 'Group Edit Mode', icon: 'mdi-group', color: 'primary' };
      }
      if (this.multiSelectActive) {
        return { text: 'Multi-select Mode', icon: 'mdi-call-merge', color: 'error' };
      }
      if (this.editingDetails !== 'disabled') {
        return {
          text: `${this.editingDetails} ${this.editingMode} `,
          icon: this.editingDetails === 'Creating' ? 'mdi-pencil-plus' : 'mdi-pencil',
          color: this.editingDetails === 'Creating' ? 'success' : 'primary',
        };
      }
      return { text: 'Not editing', icon: 'mdi-pencil-off-outline', color: '' };
    },
  },
  watch: {
    editingDetails() {
      clearTimeout(this.toolTimeTimeout);
      if (this.editingDetails !== 'disabled') {
        this.toolTipForce = true;
        this.toolTimeTimeout = setTimeout(
          () => { this.toolTipForce = false; }, 2000,
        ) as unknown as number;
      } else {
        this.toolTipForce = false;
      }
    },
  },
  methods: {
    isVisible(mode: VisibleAnnotationTypes) {
      return this.visibleModes.includes(mode);
    },

    toggleVisible(mode: VisibleAnnotationTypes) {
      if (this.isVisible(mode)) {
        this.$emit('set-annotation-state', {
          visible: this.visibleModes.filter((m) => m !== mode),
        });
      } else {
        this.$emit('set-annotation-state', {
          visible: this.visibleModes.concat([mode]),
        });
      }
    },
  },
});
</script>

<template>
  <v-row
    v-mousetrap="mousetrap"
    class="pa-0 ma-0 grow"
    no-gutters
  >
    <div class="d-flex align-center grow">
      <div
        class="pa-1 d-flex"
        style="width: 280px;"
      >
        <v-icon class="pr-1">
          {{ editingHeader.icon }}
        </v-icon>
        <div>
          <div class="text-subtitle-2">
            {{ editingHeader.text }}
          </div>
          <div
            style="line-height: 1.22em; font-size: 10px;"
          >
            <span v-if="groupEditActive">
              Editing group.  Add or remove tracks.  Esc. to exit.
            </span>
            <span v-else-if="multiSelectActive">
              Multi-select in progress.  Editing is disabled.
              Select additional tracks to merge or group.
            </span>
            <span v-else-if="editingDetails !== 'disabled'">
              {{ modeToolTips[editingDetails][editingMode] }}
            </span>
            <span v-else>Right click on an annotation to edit</span>
          </div>
        </div>
      </div>
      <v-btn
        v-for="button in editButtons"
        :key="button.id + 'view'"
        :disabled="!editingMode"
        :outlined="!button.active"
        :color="button.active ? editingHeader.color : ''"
        class="mx-1"
        small
        @click="button.click"
      >
        <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
        <v-icon>{{ button.icon }}</v-icon>
      </v-btn>
      <slot name="delete-controls" />
      <v-spacer />
      <span class="pb-1">
        <span class="mr-1 px-3 py-1">
          <v-icon class="pr-1">
            mdi-eye
          </v-icon>
          <span class="text-subtitle-2">
            Visibility
          </span>
        </span>
        <v-btn
          v-for="button in viewButtons"
          :key="button.id"
          :color="button.active ? 'grey darken-2' : ''"
          class="mx-1 mode-button"
          small
          @click="button.click"
        >
          <v-icon>{{ button.icon }}</v-icon>
        </v-btn>
        <v-menu
          open-on-hover
          bottom
          offset-y
          :close-on-content-click="false"
        >
          <template #activator="{ on, attrs }">
            <v-btn
              v-bind="attrs"
              :color="isVisible('TrackTail') ? 'grey darken-2' : ''"
              class="mx-1 mode-button"
              small
              v-on="on"
              @click="toggleVisible('TrackTail')"
            >
              <v-icon>mdi-navigation</v-icon>
            </v-btn>
          </template>
          <v-card
            class="pa-4 flex-column d-flex"
            outlined
          >
            <label for="frames-before">Frames before: {{ tailSettings.before }}</label>
            <input
              id="frames-before"
              type="range"
              name="frames-before"
              class="tail-slider-width"
              label
              min="0"
              max="100"
              :value="tailSettings.before"
              @input="$emit('update:tail-settings', {
                ...tailSettings, before: Number.parseFloat($event.target.value) })"
            >
            <div class="py-2" />
            <label for="frames-after">Frames after: {{ tailSettings.after }}</label>
            <input
              id="frames-after"
              type="range"
              name="frames-after"
              class="tail-slider-width"
              min="0"
              max="100"
              :value="tailSettings.after"
              @input="$emit('update:tail-settings', {
                ...tailSettings, after: Number.parseFloat($event.target.value) })"
            >
          </v-card>
        </v-menu>
      </span>
    </div>
  </v-row>
</template>

<style scoped>
.modechip {
  border-radius: 16px;
  white-space: nowrap;
  border: 1px solid;
  cursor: default;
}
.mode-group {
  border: 1px solid grey;
  border-radius: 4px;
}
.mode-button{
  border: 1px solid grey;
}
.tail-slider-width {
  width: 240px;
}
</style>
