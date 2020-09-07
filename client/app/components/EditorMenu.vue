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
      editButtons: [
        { id: 'rectangle', title: 'Bounds', icon: 'mdi-vector-square' },
        { id: 'Polygon', title: 'Polygon', icon: 'mdi-vector-polygon' },
      ],
      viewButtons: [
        { id: 'rectangle', title: 'Bounds', icon: 'mdi-vector-square' },
        { id: 'Polygon', title: 'Polygon', icon: 'mdi-vector-polygon' },
        {
          id: 'LineString',
          title: 'Line',
          icon: 'mdi-vector-line',
        },
      ],
    };
  },

  computed: {
    configs(): {
      color: string;
      class: string[];
      text: string;
      icon: string;
      model: string;
      value: string | string[];
      multiple: boolean;
      buttons: {
        id: string;
        title: string;
        icon: string;
      }[];
      }[] {
      return [
        {
          color: 'primary',
          class: ['primary'],
          text: 'Edit',
          icon: 'mdi-pencil',
          model: 'editing',
          value: this.editingMode.value,
          multiple: false,
          buttons: this.editButtons,
        },
        {
          color: 'grey',
          class: ['grey', 'darken-2'],
          text: 'View',
          icon: 'mdi-eye',
          model: 'visible',
          value: this.visibleModes.value,
          multiple: true,
          buttons: this.viewButtons,
        },
      ];
    },
  },
});
</script>

<template>
  <v-row>
    <v-col
      v-for="config in configs"
      :key="config.text"
      class="d-flex align-center px-4"
    >
      <span :class="['mr-3', 'px-3', 'py-1', 'modechip', ...config.class ]">
        <v-icon class="pr-1">
          {{ config.icon }}
        </v-icon>
        <span class="text-subtitle-2">
          {{ config.text }}
        </span>
      </span>
      <v-btn-toggle
        dense
        group
        :value="config.value"
        :multiple="config.multiple"
        :color="config.color"
        @change="$emit('set-annotation-state', { [config.model]: $event })"
      >
        <v-btn
          v-for="button in config.buttons"
          :key="button.id"
          style="border-radius: 3px;"
          :value="button.id"
        >
          <v-icon>{{ button.icon }}</v-icon>
        </v-btn>
      </v-btn-toggle>
    </v-col>
  </v-row>
</template>

<style scoped>
.modechip {
  border-radius: 16px;
  white-space: nowrap;
}
</style>
