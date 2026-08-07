<script lang="ts">
import type { DatasetType } from 'dive-common/apispec';
import { computed, defineComponent, PropType } from 'vue';

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
    batchMultiCamImport: { // Batch import of collect folders (collect/camera/images)
      type: Boolean,
      default: false,
    },
    largeImageImport: { // Offer tiled GeoTIFF / TIFF alongside the other sources
      type: Boolean,
      default: false,
    },
    bulkImport: { // Single/multi camera choice for bulk folder scans
      type: Boolean,
      default: false,
    },
    stereoBatchImport: { // Batch import of stereo (left/right) datasets
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
  setup(props) {
    const menuWidth = computed(() => (props.batchMultiCamImport || props.largeImageImport ? 240 : 180));
    const hasDropdown = computed(() => props.multiCamImport || props.bulkImport);

    return {
      hasDropdown,
      menuWidth,
    };
  },
});
</script>

<template>
  <div class="import-button-root">
    <v-menu
      offset-y
      offset-x
      :nudge-left="menuWidth"
      :max-width="menuWidth"
    >
      <template #activator="{ on }">
        <v-tooltip
          v-if="tooltip"
          bottom
          max-width="360"
          open-delay="50"
        >
          <template #activator="{ on: tooltipOn, attrs }">
            <v-btn
              v-bind="{ ...buttonAttrs, ...attrs }"
              :large="!small"
              :small="small"
              class="px-0 import-button"
              v-on="tooltipOn"
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
            v-if="hasDropdown"
            class="button-dropdown col-1"
            v-on="on"
          >
            mdi-chevron-down
          </v-icon>
        </v-btn>
      </template>
      <v-card outlined>
        <v-list
          v-if="bulkImport"
          dense
        >
          <v-list-item
            style="align-items':'center"
            @click="$emit('open', openType)"
          >
            <v-list-item-icon>
              <v-icon>mdi-folder-multiple</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Single Camera</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            v-if="stereoBatchImport"
            style="align-items':'center"
            @click="$emit('stereo-batch')"
          >
            <v-list-item-icon>
              <v-icon>mdi-binoculars</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Stereo</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            style="align-items':'center"
            @click="$emit('multi-cam-batch')"
          >
            <v-list-item-icon>
              <v-icon>mdi-folder-multiple-image</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Multi Camera</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list>
        <v-list
          v-else
          dense
        >
          <v-list-item
            v-if="['image-sequence', 'large-image'].includes(openType)"
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
              <v-list-item-title>Single File</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            v-if="['image-sequence', 'large-image'].includes(openType)"
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
          <v-tooltip
            v-if="largeImageImport"
            right
            max-width="360"
            open-delay="50"
          >
            <template #activator="{ on: tooltipOn }">
              <v-list-item
                style="align-items':'center"
                v-on="tooltipOn"
                @click="$emit('open', 'large-image')"
              >
                <v-list-item-icon>
                  <v-icon>mdi-map</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title>Tiled GeoTIFF / TIFF</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </template>
            <span>
              Open a high-resolution geospatial image for tiled viewing. Supported formats:
              .tif, .tiff, .geotiff. Files should include internal pyramid overviews
              (COG recommended) for best performance.
            </span>
          </v-tooltip>
          <v-list-item
            style="align-items':'center"
            @click="$emit('multi-cam', { stereo: true, openType })"
          >
            <v-list-item-icon>
              <v-icon>mdi-binoculars</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Stereo</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            style="align-items':'center"
            @click="$emit('multi-cam', { stereo: false, openType })"
          >
            <v-list-item-icon>
              <v-icon>mdi-camera-burst</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Multi Camera</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            v-if="batchMultiCamImport"
            style="align-items':'center"
            @click="$emit('multi-cam-batch')"
          >
            <v-list-item-icon>
              <v-icon>mdi-folder-multiple-image</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Multi Camera Batch</v-list-item-title>
            </v-list-item-content>
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
