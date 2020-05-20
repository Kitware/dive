<script>
import { getExportUrls } from '@/lib/api/viameDetection.service';
import { MediaTypes } from '@/constants';

export default {
  props: {
    folderId: {
      type: String,
      required: true,
    },
  },

  data() {
    return {
      menuOpen: false,
    };
  },

  asyncComputed: {
    async exportUrls() {
      return getExportUrls(this.folderId);
    },
  },

  computed: {
    mediaType() {
      return MediaTypes[this.exportUrls.mediaType];
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
  >
    <template #activator="{ on }">
      <v-btn
        class="ma-0"
        text
        small
        v-on="on"
      >
        <v-icon
          left
          color="accent"
          class="mdi-24px mr-1"
        >
          mdi-export
        </v-icon>
        Export
      </v-btn>
    </template>
    <template>
      <v-card v-if="menuOpen && exportUrls">
        <v-card-title>
          Export options
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
          Get latest detections csv only
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
            <span v-if="exportUrls.exportDetectionsUrl">detections </span>
            <span v-else>detections unavailable</span>
          </v-btn>
        </v-card-actions>

        <v-card-text class="pb-0">
          Zip all media, detections, and edit history
          <br> recursively from all sub-folders
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
