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
  },
});
</script>

<template>
  <span class="mx-1">
    <v-btn
      v-if="!disabled"
      color="error"
      depressed
      small
      @click="deleteSelected"
    >
      <pre class="mr-1 text-body-2">del</pre>
      <span v-if="selectedFeatureHandle >= 0">
        point {{ selectedFeatureHandle }}
      </span>
      <span v-else-if="editingMode">
        {{ editingMode }}
      </span>
      <span v-else>unselected</span>
      <v-icon
        small
        class="ml-2"
      >
        mdi-delete
      </v-icon>
    </v-btn>
  </span>
</template>
