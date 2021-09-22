<script lang="ts">
import { defineComponent, ref, toRef } from '@vue/composition-api';

export default defineComponent({
  name: 'ViewerAlert',
  setup(_, { root }) {
    const dialog = ref(false);

    const brandData = toRef(root.$store.state.Brand, 'brandData');

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
    <template v-slot:activator="{ on, attrs }">
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
