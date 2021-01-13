<script lang="ts">
import { join } from 'path';
import { defineComponent } from '@vue/composition-api';

import { DatasetType } from 'viame-web-common/apispec';

import { openFromDisk, importMedia } from '../api';
import { getRecents } from '../store/dataset';
import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';

export default defineComponent({
  components: {
    BrowserLink,
    NavigationBar,
  },
  setup(_, { root }) {
    const recents = getRecents().splice(0, 20);
    async function open(dstype: DatasetType) {
      const ret = await openFromDisk(dstype);
      if (!ret.canceled) {
        const meta = await importMedia(ret.filePaths[0]);
        root.$router.push({
          name: 'viewer',
          params: { id: meta.id },
        });
      }
    }
    return { open, recents, join };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container>
      <v-col>
        <v-row>
          <v-col
            md="8"
            sm="6"
          >
            <h1 class="text-h3 mb-4 font-weight-light">
              DIVE Annotation Tool
            </h1>
            <h3>Useful Links</h3>
            <browser-link href="https://viame.github.io/VIAME-Web/">
              User Guide
            </browser-link>
            <browser-link href="https://viame.kitware.com/#/collection/5e4c256ca0fc86aa03120c34">
              Public example data
            </browser-link>
            <browser-link href="https://viametoolkit.org/">
              viametoolkit.org
            </browser-link>
          </v-col>
          <v-col
            md="4"
            sm="6"
          >
            <v-btn
              large
              block
              color="primary"
              class="mb-6"
              @click="open('image-sequence')"
            >
              Open Image Sequence
              <v-icon class="ml-2">
                mdi-folder-open
              </v-icon>
            </v-btn>
            <v-btn
              block
              large
              color="primary"
              @click="open('video')"
            >
              Open Video
              <v-icon class="ml-2">
                mdi-file-video
              </v-icon>
            </v-btn>
          </v-col>
        </v-row>
        <v-row>
          <v-card
            class="px-4 py-2 my-4"
            min-width="100%"
          >
            <h2 class="text-h4 font-weight-light mb-2">
              Recent
            </h2>
            <div
              v-for="recent in recents"
              :key="recent.id"
              class="pa-1"
            >
              <h3 class="text-body-1">
                <v-icon
                  class="pr-2"
                  color="primary lighten-2"
                >
                  {{
                    (recent.type === 'video')
                      ? 'mdi-file-video'
                      : (recent.originalImageFiles.length > 1)
                        ? 'mdi-image-multiple'
                        : 'mdi-image'
                  }}
                </v-icon>
                <router-link
                  :to="{ name: 'viewer', params: { id: recent.id } }"
                  class="primary--text text--lighten-3 text-decoration-none"
                >
                  {{ recent.name }}
                </router-link>
                <span class="grey--text px-4">
                  {{ recent.originalBasePath }}
                </span>
              </h3>
            </div>
          </v-card>
        </v-row>
      </v-col>
    </v-container>
  </v-main>
</template>