<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import { EditAnnotationTypes } from '@/components/layers/EditAnnotationLayer';

export default Vue.extend({
  name: 'EditorMenu',
  props: {
    editingTrack: {
      type: Object as PropType<Ref<boolean>>,
      required: true,
    },
    annotationState: {
      type: Object as PropType<Ref<{
        visible: EditAnnotationTypes[];
        editing: EditAnnotationTypes;
      }>>,
      required: true,
    },
  },

  data() {
    return {
      buttons: [
        { id: 'rectangle', title: 'Bounds', icon: 'mdi-vector-square' },
        { id: 'polygon', title: 'Polygon', icon: 'mdi-vector-polygon' },
      ],
    };
  },

  computed: {
    config() {
      if (this.editingTrack.value) {
        return {
          color: 'primary',
          text: 'Edit',
          icon: 'mdi-pencil',
          model: 'editing',
          multiple: false,
        };
      }
      return {
        color: 'default',
        text: 'View',
        icon: 'mdi-eye',
        model: 'visible',
        multiple: true,
      };
    },
  },

  methods: {
    deletePoint() {
      this.$emit('delete-point');
    },
  },
});
</script>

<template>
  <v-row>
    <v-divider vertical />
    <v-col class="d-flex align-center py-0">
      <v-chip
        :color="config.color"
        class="mr-1"
        style="width: 115px;"
      >
        <v-icon
          small
          class="pr-1"
        >
          {{ config.icon }}
        </v-icon>
        <span class="text-subtitle-2">
          {{ config.text }} mode
        </span>
      </v-chip>
      <v-btn-toggle
        v-model="annotationState.value[config.model]"
        :multiple="config.multiple"
        group
      >
        <v-btn
          v-for="button in buttons"
          :key="button.id"
          :value="button.id"
          outlined
          icon
          active-class="active-editor-menu-button"
          style="border-radius: 5px;"
          :color="config.color"
        >
          <v-icon>{{ button.icon }}</v-icon>
        </v-btn>
      </v-btn-toggle>
    </v-col>
    <v-divider vertical />
  </v-row>
</template>
