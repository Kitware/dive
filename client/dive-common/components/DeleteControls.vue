<script lang="ts">
import Vue, { PropType } from 'vue';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/';

export default Vue.extend({
  name: 'DeleteControls',

  props: {
    selectedFeatureHandle: {
      type: Number,
      required: true,
    },
    editingMode: {
      type: [String, Boolean] as PropType<EditAnnotationTypes | boolean>,
      required: true,
    },
  },

  computed: {
    disabled(): boolean {
      if (this.selectedFeatureHandle < 0 && this.editingMode === false) {
        return true;
      }
      if (this.editingMode === 'rectangle') {
        return true; // deleting rectangle is unsupported
      }
      return false;
    },
    isPolygonMode(): boolean {
      return this.editingMode === 'Polygon';
    },
    editModeIcon(): string {
      if (this.editingMode === 'Polygon') return 'mdi-vector-polygon';
      if (this.editingMode === 'LineString') return 'mdi-vector-line';
      if (this.editingMode === 'rectangle') return 'mdi-vector-square';
      return 'mdi-shape';
    },
  },

  methods: {
    deleteSelected() {
      if (this.disabled) {
        throw new Error('Cannot delete while disabled!');
      }
      if (this.selectedFeatureHandle >= 0) {
        this.$emit('delete-point');
      } else {
        this.$emit('delete-annotation');
      }
    },
    addHole() {
      this.$emit('add-hole');
    },
    addPolygon() {
      this.$emit('add-polygon');
    },
  },
});
</script>

<template>
  <span class="mx-1 d-flex align-center">
    <!-- Add Hole button - shown in polygon edit mode -->
    <v-tooltip
      v-if="isPolygonMode"
      bottom
    >
      <template #activator="{ on, attrs }">
        <v-btn
          v-bind="attrs"
          color="primary"
          depressed
          small
          class="mr-1"
          v-on="on"
          @click="addHole"
        >
          <v-icon small>
            mdi-vector-polygon
          </v-icon>
          <v-icon
            x-small
            class="ml-n1"
          >
            mdi-minus-circle-outline
          </v-icon>
        </v-btn>
      </template>
      <span>Add hole to polygon</span>
    </v-tooltip>

    <!-- Add Polygon button - shown in polygon edit mode -->
    <v-tooltip
      v-if="isPolygonMode"
      bottom
    >
      <template #activator="{ on, attrs }">
        <v-btn
          v-bind="attrs"
          color="primary"
          depressed
          small
          class="mr-1"
          v-on="on"
          @click="addPolygon"
        >
          <v-icon small>
            mdi-vector-polygon
          </v-icon>
          <v-icon
            x-small
            class="ml-n1"
          >
            mdi-plus-circle-outline
          </v-icon>
        </v-btn>
      </template>
      <span>Add another polygon</span>
    </v-tooltip>

    <!-- Delete button -->
    <v-tooltip
      v-if="!disabled"
      bottom
    >
      <template #activator="{ on, attrs }">
        <v-btn
          v-bind="attrs"
          color="error"
          depressed
          small
          v-on="on"
          @click="deleteSelected"
        >
          <span class="mr-1 text-body-2 font-weight-bold">DEL</span>
          <span v-if="selectedFeatureHandle >= 0">
            pt{{ selectedFeatureHandle }}
          </span>
          <v-icon
            v-else
            small
          >
            {{ editModeIcon }}
          </v-icon>
        </v-btn>
      </template>
      <span v-if="selectedFeatureHandle >= 0">Delete point {{ selectedFeatureHandle }}</span>
      <span v-else-if="editingMode">Delete {{ editingMode }}</span>
    </v-tooltip>
  </span>
</template>
