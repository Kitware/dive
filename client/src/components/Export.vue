<script>
import { getExportUrl } from '@/common/api';
import {
  ImageSequenceType,
  VideoType,
} from '@/constants';

const MediaTypeMap = {
  [ImageSequenceType]: 'image sequence',
  [VideoType]: 'video',
};

export default {
  props: {
    title: {
      type: String,
      required: true,
    },
    folderId: {
      type: String,
      required: true,
    },
    folderType: {
      type: String,
      default: '',
    },
    isViameFolder: {
      type: Boolean,
      default: false,
    },
  },

  data() {
    return {
      menuOpen: false,
    };
  },

  methods: { getExportUrl },

  computed: {
    mediaType() {
      return MediaTypeMap[this.folderType];
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
      <v-card>
        <v-card-title>
          Export options
        </v-card-title>

        <template v-if="isViameFolder">
          <v-card-text class="pb-0">
            Zip all {{ mediaType }} files
          </v-card-text>
          <v-card-actions>
            <v-btn
              depressed
              block
              target="_blank"
              :href="getExportUrl(folderId, 'media')"
            >
              {{ mediaType }}
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
              :href="getExportUrl(folderId, 'detections')"
            >
              detections
            </v-btn>
          </v-card-actions>
        </template>
        <v-card-text class="pb-0">
          Zip all media, detections, and edit history
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            block
            target="_blank"
            :href="getExportUrl(folderId, 'all')"
          >
            Everything
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-menu>
</template>
