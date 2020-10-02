<script lang="ts">
import { flatten } from 'lodash';
import Vue, { PropType } from 'vue';

import { Mousetrap } from 'vue-media-annotator/types';
import { EditAnnotationTypes } from 'vue-media-annotator/layers';
import Recipe from 'vue-media-annotator/recipe';

interface ButtonData {
  id: string;
  icon: string;
  type?: EditAnnotationTypes;
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
      type: Array as PropType<EditAnnotationTypes[]>,
      required: true,
    },
    editingMode: {
      type: [String, Boolean] as PropType<false | EditAnnotationTypes>,
      required: true,
    },
    recipes: {
      type: Array as PropType<Recipe[]>,
      required: true,
    },
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
      ];
    },
    mousetrap(): Mousetrap[] {
      return flatten(this.editButtons.map((b) => b.mousetrap || []));
    },
  },

  methods: {
    isVisible(mode: EditAnnotationTypes) {
      return this.visibleModes.includes(mode);
    },

    toggleVisible(mode: EditAnnotationTypes) {
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
  >
    <v-col class="d-flex align-center px-4">
      <span
        class="mr-1 px-3 py-1 modechip grey darken-2"
      >
        <v-icon class="pr-1">
          mdi-eye
        </v-icon>
        <span class="text-subtitle-2">
          Visibilty
        </span>
      </span>
      <v-btn
        v-for="button in viewButtons"
        :key="button.id"
        :outlined="!button.active"
        :color="button.active ? 'grey darken-2' : ''"
        class="mx-1"
        @click="button.click"
      >
        <v-icon>{{ button.icon }}</v-icon>
      </v-btn>
      <span
        :class="[
          'ml-8', 'mr-1', 'px-3', 'py-1',
          'modechip', editingTrack ? 'primary' : ''
        ]"
      >
        <v-icon class="pr-1">
          mdi-pencil
        </v-icon>
        <span class="text-subtitle-2">
          Editing
        </span>
      </span>
      <v-btn
        v-for="button in editButtons"
        :key="button.id + 'view'"
        :outlined="!button.active"
        :color="button.active ? 'primary' : ''"
        class="mx-1"
        @click="button.click"
      >
        <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
        <v-icon>{{ button.icon }}</v-icon>
      </v-btn>
    </v-col>
  </v-row>
</template>

<style scoped>
.modechip {
  border-radius: 4px;
  white-space: nowrap;
  border: 1px solid;
}
</style>
