<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';

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
  },

  data() {
    return {
      buttons: [
        { id: 'rectangle', title: 'Bounds', icon: 'mdi-vector-square' },
        { id: 'polygon', title: 'Polygon', icon: 'mdi-vector-polygon' },
        { id: 'line', title: 'Line', icon: 'mdi-vector-line' },

      ],
    };
  },

  computed: {
    config(): {
      color: string;
      class: string[];
      text: string;
      icon: string;
      model: string;
      value: string | string[];
      multiple: boolean;
      } {
      if (this.editingTrack.value) {
        return {
          color: 'primary',
          class: ['primary'],
          text: 'Edit',
          icon: 'mdi-pencil',
          model: 'editing',
          value: this.editingMode.value,
          multiple: false,
        };
      }
      return {
        color: 'grey',
        class: ['grey', 'darken-2'],
        text: 'View',
        icon: 'mdi-eye',
        model: 'visible',
        value: this.visibleModes.value,
        multiple: true,
      };
    },
  },
});
</script>

<template>
  <v-row>
    <v-divider vertical />
    <v-col class="d-flex align-center py-0">
      <span :class="['mr-1', 'px-2', 'py-1', 'modechip', ...config.class ]">
        <v-icon class="pr-1">
          {{ config.icon }}
        </v-icon>
        <span class="text-subtitle-2">
          {{ config.text }} mode
        </span>
      </span>
      <v-btn-toggle
        :value="config.value"
        :multiple="config.multiple"
        :mandatory="!config.multiple"
        group
        @change="$emit('set-annotaiton-state', { [config.model]: $event })"
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

<style scoped>
.modechip {
  border-radius: 16px;
  width: 120px;
}
</style>
