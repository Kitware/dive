<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/';

export default defineComponent({
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

  setup(props) {
    const showDeleteButton = computed((): boolean => {
      if (!props.editingMode) {
        return false;
      }
      if (props.selectedFeatureHandle >= 0) {
        return props.editingMode === 'Polygon' || props.editingMode === 'LineString';
      }
      return props.editingMode !== 'rectangle';
    });

    return {
      showDeleteButton,
    };
  },

  methods: {
    deleteSelected() {
      if (!this.showDeleteButton) {
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
      v-if="showDeleteButton"
      color="error"
      variant="flat"
      size="small"
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
        size="small"
        class="ml-2"
      >
        mdi-delete
      </v-icon>
    </v-btn>
  </span>
</template>
