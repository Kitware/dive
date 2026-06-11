<script lang="ts">
import { useBrand } from 'platform/web-girder/store/useBrand';
import { defineComponent, ref } from 'vue';

export default defineComponent({
  name: 'ViewerAlert',
  setup() {
    const { brandData } = useBrand();
    const dialog = ref(false);

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
    <template #activator="{ props: activatorProps }">
      <v-btn
        icon
        color="warning"
        v-bind="activatorProps"
      >
        <v-icon
          size="large"
          icon="mdi-alert-circle"
        />
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
