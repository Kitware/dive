<script lang="ts">
import { useStore } from 'platform/web-girder/store/types';
import { defineComponent, ref, toRef } from 'vue';

export default defineComponent({
  name: 'ViewerAlert',
  setup() {
    const store = useStore();
    const dialog = ref(false);

    const brandData = toRef(store.state.Brand, 'brandData');

    return {
      dialog,
      brandData,
    };
  },
});
</script>

<template>
  <v-dialog
    v-if="brandData.alertMessage"
    v-model="dialog"
    max-width="600px"
    overlay-opacity="0.90"
  >
    <template #activator="{ on, attrs }">
      <v-btn
        icon
        dark
        color="warning"
        v-bind="attrs"
        v-on="on"
      >
        <v-icon
          large
        >
          mdi-alert-circle
        </v-icon>
      </v-btn>
    </template>
    <v-card
      color="warning"
      class="d-flex justify-space-between align-center pa-4"
    >
      {{ brandData.alertMessage }}
      <v-btn
        icon
        @click="dialog = false"
      >
        <v-icon>
          mdi-close
        </v-icon>
      </v-btn>
    </v-card>
  </v-dialog>
</template>
