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
  },

  methods: {
    deleteHandle() {
      if (this.disabled) {
        throw new Error('Cannot delete while disabled!');
      }
      if (this.selectedFeatureHandle >= 0) {
        this.$emit('delete-point');
      }
    },
    deleteAnnotation() {
      if (this.disabled) {
        throw new Error('Cannot delete while disabled!');
      }
      this.$emit('delete-annotation');
    },
  },
});
</script>

<template>
  <div class="d-flex flex-row">
    <v-divider
      vertical
      class="mx-2"
    />
    <v-btn
      v-if="!disabled"
      color="error"
      depressed
      small
      class="mr-2"
      @click="deleteAnnotation"
    >
      <v-icon
        small
        class="mr-2"
      >
        mdi-delete
      </v-icon>
      <v-icon
        v-if="editingMode === 'Polygon'"
      >
        mdi-vector-polygon
      </v-icon>
      <v-icon v-else>
        mdi-vector-line
      </v-icon>
    </v-btn>
    <v-btn
      v-if="!disabled && selectedFeatureHandle >= 0"
      color="error"
      depressed
      small
      @click="deleteHandle"
    >
      <v-icon
        small
        class="mr-1"
      >
        mdi-delete
      </v-icon>
      <v-icon class="pr-1">
        mdi-circle-outline
      </v-icon>
      {{ selectedFeatureHandle }}
    </v-btn>
  </div>
</template>
