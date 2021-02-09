<script>
import { MediaTypes } from 'dive-common/constants';
import { getExportUrls } from '../api/viameDetection.service';

export default {
  props: {
    datasetId: {
      type: String,
      required: true,
    },
    small: {
      type: Boolean,
      default: false,
    },
  },

  data() {
    return {
      menuOpen: false,
      excludeFiltered: false,
      activator: 0,
    };
  },

  asyncComputed: {
    async exportUrls() {
      if (this.menuOpen) {
        return getExportUrls(this.datasetId, this.excludeFiltered);
      }
      return null;
    },
  },

  computed: {
    mediaType() {
      return MediaTypes[this.exportUrls.mediaType];
    },
    thresholds() {
      return Object.keys(this.exportUrls.currentThresholds || {});
    },
  },
};
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    :nudge-width="120"
    offset-y
    max-width="280"
  >
    <template #activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            class="ma-0"
            text
            :small="small"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <v-icon color="accent">
              mdi-download
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown"
              class="pl-1"
            >
              Download
            </span>
          </v-btn>
        </template>
        <span>Download media and annotations</span>
      </v-tooltip>
    </template>
    <template>
      <v-card v-if="menuOpen && exportUrls">
        <v-card-title>
          Download options
        </v-card-title>

        <v-card-text class="pb-0">
          Zip all {{ mediaType || 'media' }} files only
        </v-card-text>
        <v-card-actions>
          <v-btn
            depressed
            block
            target="_blank"
            :disabled="!exportUrls.exportMediaUrl"
            :href="exportUrls.exportMediaUrl"
          >
            {{ mediaType || 'media unavailable' }}
          </v-btn>
        </v-card-actions>

        <v-card-text class="pb-0">
          <div>Get latest detections csv only</div>
          <template v-if="thresholds.length">
            <v-checkbox
              v-model="excludeFiltered"
              label="exclude tracks below confidence threshold"
              dense
              hide-details
            />
            <div class="py-2">
              <span>Current thresholds:</span>
              <span
                v-for="(val, key) in exportUrls.currentThresholds"
                :key="key"
                class="pt-2"
              >
                ({{ key }}, {{ val }})
              </span>
            </div>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            block
            target="_blank"
            :disabled="!exportUrls.exportDetectionsUrl"
            :href="exportUrls.exportDetectionsUrl"
          >
            <span v-if="exportUrls.exportDetectionsUrl">detections</span>
            <span v-else>detections unavailable</span>
          </v-btn>
        </v-card-actions>

        <v-card-text class="pb-0">
          Zip all media, detections, and edit history recursively from all sub-folders
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            block
            target="_blank"
            :href="exportUrls.exportAllUrl"
          >
            Everything
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-menu>
</template>
