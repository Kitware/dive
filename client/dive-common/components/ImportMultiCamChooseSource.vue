<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';
import { DatasetType } from 'dive-common/apispec';

export default defineComponent({
  props: {
    cameraName: {
      type: String,
      required: true,
    },
    dataType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
    value: {
      type: String,
      required: true,
    },
    showDelete: {
      type: Boolean,
      default: false,
    },
  },
});
</script>

<template>
  <v-row
    no-gutters
    class="align-center"
  >
    <v-text-field
      :placeholder="dataType === 'image-sequence'
        ? 'Choose folder or image list' : 'Choose Video'
      "
      disabled
      outlined
      dense
      hide-details
      class="mr-3"
      :value="value"
    />
    <v-btn
      color="primary"
      class="mr-3"
      @click="$emit('open')"
    >
      {{ dataType === 'image-sequence' ? 'Folder' : 'Open Video' }}
      <v-icon class="ml-2">
        {{ dataType === 'image-sequence' ? 'mdi-folder-open' : 'mdi-file-video' }}
      </v-icon>
    </v-btn>
    <v-btn
      v-if="dataType === 'image-sequence'"
      color="primary"
      @click="$emit('open-text')"
    >
      List File
      <v-icon class="ml-2">
        mdi-view-list-outline
      </v-icon>
    </v-btn>
  </v-row>
</template>
