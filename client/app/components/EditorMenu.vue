<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';

import { RecipeMapEntry } from 'app/recipes';

interface ButtonData {
  id: string;
  icon: string;
  type?: EditAnnotationTypes;
  active: boolean;
  activate: () => void;
}

export default Vue.extend({
  name: 'EditorMenu',
  props: {
    editingTrack: {
      type: Object as PropType<Ref<boolean>>,
      required: true,
    },
    visibleModes: {
      type: Object as PropType<Ref<EditAnnotationTypes[]>>,
      required: true,
    },
    editingMode: {
      type: Object as PropType<Ref<EditAnnotationTypes>>,
      required: true,
    },
    recipeMap: {
      type: Object as PropType<Record<string, RecipeMapEntry>>,
      required: true,
    },
  },

  computed: {
    editButtons(): ButtonData[] {
      const em = this.editingMode.value;
      return [
        {
          id: 'rectangle',
          icon: 'mdi-vector-square',
          active: em === 'rectangle',
          activate: () => {
            this.$emit('set-annotation-state', { editing: 'rectangle' });
          },
        },
        {
          id: 'Polygon',
          icon: 'mdi-vector-polygon',
          active: em === 'Polygon',
          activate: () => {
            this.$emit('set-annotation-state', { editing: 'Polygon' });
          },
        },
        /* Include recipes as editing modes */
        ...(Object.values(this.recipeMap).filter((r) => r.toggleable).map((r) => ({
          id: r.id,
          icon: r.icon || 'mdi-pencil',
          active: r.recipe.active.value,
          activate: () => {
            this.$emit('set-annotation-state', { recipe: r.recipe });
          },
        }))),
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
          activate: () => this.toggleVisible('rectangle'),
        },
        {
          id: 'Polygon',
          type: 'Polygon',
          icon: 'mdi-vector-polygon',
          active: this.isVisible('Polygon'),
          activate: () => this.toggleVisible('Polygon'),
        },
        {
          id: 'LineString',
          type: 'LineString',
          active: this.isVisible('LineString'),
          icon: 'mdi-vector-line',
          activate: () => this.toggleVisible('LineString'),
        },
      ];
    },
  },

  methods: {
    isVisible(mode: EditAnnotationTypes) {
      return this.visibleModes.value.includes(mode);
    },

    toggleVisible(mode: EditAnnotationTypes) {
      if (this.isVisible(mode)) {
        this.$emit('set-annotation-state', {
          visible: this.visibleModes.value.filter((m) => m !== mode),
        });
      } else {
        this.$emit('set-annotation-state', {
          visible: this.visibleModes.value.concat([mode]),
        });
      }
    },
  },
});
</script>

<template>
  <v-row>
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
        @click="button.activate"
      >
        <v-icon>{{ button.icon }}</v-icon>
      </v-btn>
      <span
        :class="[
          'ml-8', 'mr-1', 'px-3', 'py-1',
          'modechip', editingTrack.value ? 'primary' : ''
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
        @click="button.activate"
      >
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
