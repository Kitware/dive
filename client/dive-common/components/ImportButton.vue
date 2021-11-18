<script lang="ts">
import type { DatasetType } from 'dive-common/apispec';
import { defineComponent, PropType } from '@vue/composition-api';

export const DefaultButtonAttrs = {
  block: true,
  color: 'primary',
  class: ['grow'],
};

export default defineComponent({
  name: 'ImportMultiCamAddType',
  props: {
    name: {
      type: String,
      required: true,
    },
    icon: {
      type: String,
      required: true,
    },
    openType: {
      type: String as PropType<DatasetType | 'zip'>,
      required: true,
    },
    multiCamImport: { //TODO: Temporarily used to hide the stereo settings from users
      type: Boolean,
      default: false,
    },
    buttonAttrs: {
      type: Object,
      default: () => DefaultButtonAttrs,
    },
    small: { // Smaller setting for "Add Another ..."
      type: Boolean,
      default: false,
    },
  },
  setup() {
    return {
    };
  },
});
</script>

<template>
  <div>
    <v-menu
      offset-y
      offset-x
      nudge-left="180"
      max-width="180"
    >
      <template v-slot:activator="{ on }">
        <v-btn
          v-bind="buttonAttrs"
          :large="!small"
          :small="small"
          class="px-0"
          @click="$emit('open', openType)"
        >
          <div class="col-11">
            {{ name }}
            <v-icon class="ml-2">
              {{ icon }}
            </v-icon>
          </div>
          <v-icon
            v-if="multiCamImport"
            class="button-dropdown col-1"
            v-on="on"
          >
            mdi-chevron-down
          </v-icon>
        </v-btn>
      </template>
      <v-card outlined>
        <v-list dense>
          <v-list-item
            v-if="openType === 'image-sequence'"
            style="align-items':'center"
            @click="$emit('open', openType)"
          >
            <v-list-item-icon>
              <v-icon>mdi-folder-open</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Directory</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            v-else-if="openType === 'video'"
            style="align-items':'center"
            @click="$emit('open', openType)"
          >
            <v-list-item-icon>
              <v-icon>mdi-file-video</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>From File</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            v-if="openType === 'image-sequence'"
            style="align-items':'center"
            @click="$emit('open', 'text')"
          >
            <v-list-item-icon>
              <v-icon>mdi-view-list-outline</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Image List</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            style="align-items':'center"
            @click="$emit('multi-cam',{ stereo: true, openType })"
          >
            <v-list-item-icon>
              <v-icon>mdi-binoculars</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Stereoscopic</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            style="align-items':'center"
            @click="$emit('multi-cam',{ stereo: false, openType })"
          >
            <v-list-item-icon>
              <v-icon>mdi-camera-burst</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>MultiCam</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped lang="scss">
.button-dropdown {
  height: 44px;
  border-left: 1px solid white;
}
.button-dropdown::after {
  border-radius: 5px !important;
}
</style>
