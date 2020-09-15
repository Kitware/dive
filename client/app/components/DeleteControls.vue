<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';
import Track, { TrackId } from 'vue-media-annotator/track';

export default Vue.extend({
  name: 'DeleteControls',

  props: {
    selectedFeatureHandle: {
      type: Object as PropType<Ref<number>>,
      required: true,
    },
    editingMode: {
      type: Object as PropType<Ref<EditAnnotationTypes | boolean>>,
      required: true,
    },
  },

  computed: {
    disabled(): boolean {
      if (this.selectedFeatureHandle.value < 0 && this.editingMode.value === false) {
        return true;
      }
      if (this.editingMode.value === 'rectangle') {
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
      if (this.selectedFeatureHandle.value >= 0) {
        this.$emit('delete-point', this.selectedFeatureHandle.value);
      } else {
        this.$emit('delete-annotation', this.editingMode.value);
      }
    },
  },
});
</script>

<template>
  <div>
    <v-btn
      color="error"
      depressed
      :disabled="disabled"
      @click="deleteSelected"
    >
      <pre class="mr-1 text-body-2">q: del</pre>
      <span v-if="selectedFeatureHandle.value >= 0">
        point {{ selectedFeatureHandle.value }}
      </span>
      <span v-else-if="editingMode.value">
        {{ editingMode.value }}
      </span>
      <span v-else>unselected</span>
      <v-icon
        small
        class="ml-2"
      >
        mdi-delete
      </v-icon>
    </v-btn>
  </div>
</template>
