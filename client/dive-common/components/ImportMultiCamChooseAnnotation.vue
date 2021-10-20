<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  props: {
    trackFile: String,
    cameraName: String,
  },
});
</script>

<template>
  <v-row
    class="align-center"
    no-gutters
  >
    <v-text-field
      label="Annotation File"
      :placeholder="`Annotation File (${cameraName})`"
      outlined
      dense
      hide-details
      clearable
      :value="trackFile"
      class="mr-3"
      @click:clear="$emit('clear')"
    />
    <v-btn
      color="primary"
      @click="$emit('open')"
    >
      Open
      <v-icon class="ml-2">
        mdi-file-table
      </v-icon>
    </v-btn>
  </v-row>
</template>
