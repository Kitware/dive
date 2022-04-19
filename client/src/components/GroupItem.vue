<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';
import Group from '../Group';

export default defineComponent({
  props: {
    group: {
      type: Object as PropType<Group>,
      required: true,
    },
    color: {
      type: String,
      required: true,
    },
    selected: {
      type: Boolean,
      required: true,
    },
  },
});
</script>

<template>
  <v-list-item dense>
    <v-list-item-content>
      <v-list-item-title class="d-flex align-center">
        <div
          class="type-color-box mr-2"
          :style="{
            backgroundColor: color,
          }"
        />
        <pre>{{ group.id }}</pre>
        {{ group.getType()[0] }}
      </v-list-item-title>
      <v-list-item-subtitle>
        Participants: {{ Object.keys(group.members).length }}
      </v-list-item-subtitle>
    </v-list-item-content>
  </v-list-item>
</template>

<style scoped>
.type-color-box {
  min-width: 10px;
  max-width: 10px;
  min-height: 10px;
  max-height: 10px;
}
</style>
