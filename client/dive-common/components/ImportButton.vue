<script lang="ts">
import type { DatasetType } from 'dive-common/apispec';
import { defineComponent, PropType } from 'vue';

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
      type: String as PropType<DatasetType | 'zip' | 'bulk'>,
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
    tooltip: {
      type: String,
      default: '',
    },
  },
  setup() {
    return {
    };
  },
});
</script>

<template>
  <div class="import-button-root">
    <v-menu
      offset-y
      offset-x
      nudge-left="180"
      max-width="180"
    >
      <template #activator="{ props: menuActivatorProps }">
        <v-tooltip
          v-if="tooltip"
          location="bottom"
          max-width="360"
          :open-delay="50"
        >
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="{ ...buttonAttrs, ...tooltipProps }"
              :large="!small"
              :small="small"
              class="px-0 import-button"
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
                v-bind="menuActivatorProps"
              >
                mdi-chevron-down
              </v-icon>
            </v-btn>
          </template>
          <span>{{ tooltip }}</span>
        </v-tooltip>
        <v-btn
          v-else
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
            v-bind="menuActivatorProps"
          >
            mdi-chevron-down
          </v-icon>
        </v-btn>
      </template>
      <v-card outlined>
        <v-list dense>
          <v-list-item
            v-if="['image-sequence', 'large-image'].includes(openType)"
            style="align-items':'center"
            @click="$emit('open', openType)"
          >
            <template #prepend>
              <v-icon>mdi-folder-open</v-icon>
            </template>
            <v-list-item-title>Directory</v-list-item-title>
          </v-list-item>
          <v-list-item
            v-else-if="openType === 'video'"
            style="align-items':'center"
            @click="$emit('open', openType)"
          >
            <template #prepend>
              <v-icon>mdi-file-video</v-icon>
            </template>
            <v-list-item-title>From File</v-list-item-title>
          </v-list-item>
          <v-list-item
            v-if="['image-sequence', 'large-image'].includes(openType)"
            style="align-items':'center"
            @click="$emit('open', 'text')"
          >
            <template #prepend>
              <v-icon>mdi-view-list-outline</v-icon>
            </template>
            <v-list-item-title>Image List</v-list-item-title>
          </v-list-item>
          <v-list-item
            style="align-items':'center"
            @click="$emit('multi-cam', { stereo: true, openType })"
          >
            <template #prepend>
              <v-icon>mdi-binoculars</v-icon>
            </template>
            <v-list-item-title>Stereoscopic</v-list-item-title>
          </v-list-item>
          <v-list-item
            style="align-items':'center"
            @click="$emit('multi-cam', { stereo: false, openType })"
          >
            <template #prepend>
              <v-icon>mdi-camera-burst</v-icon>
            </template>
            <v-list-item-title>MultiCam</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped lang="scss">
.import-button-root {
  width: 100%;
}

.import-button {
  width: 100%;
}

.button-dropdown {
  height: 44px;
  border-left: 1px solid white;
}
.button-dropdown::after {
  border-radius: 5px !important;
}
</style>
