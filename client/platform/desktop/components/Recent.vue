<script lang="ts">
import { join } from 'path';
import { defineComponent } from '@vue/composition-api';

import { DatasetType } from 'viame-web-common/apispec';

import { openFromDisk } from '../api/main';
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
        root.$router.push({
          name: 'viewer',
          params: { path: ret.filePaths[0] },
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
          <v-col cols="8">
            <h1 class="text-h3 mb-4 font-weight-light">
              VIAME Annotation Tool
            </h1>
            <h3>Useful Links</h3>
            <browser-link href="https://github.com/VIAME/VIAME-Web/wiki">
              User Guide
            </browser-link>
            <browser-link href="https://viame.kitware.com/#/collection/5e4c256ca0fc86aa03120c34">
              Public example data
            </browser-link>
            <browser-link href="https://viametoolkit.org/">
              viametoolkit.org
            </browser-link>
          </v-col>
          <v-col cols="4">
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
              :key="recent.dir + recent.base"
              class="pa-1"
            >
              <h3 class="text-body-1">
                <v-icon
                  class="pr-2"
                  color="primary lighten-2"
                >
                  {{ recent.ext ? 'mdi-file-video' : 'mdi-folder-open' }}
                </v-icon>
                <router-link
                  :to="{ name: 'viewer', params: { path: join(recent.dir, recent.base) } }"
                  class="primary--text text--lighten-3 text-decoration-none"
                >
                  {{ recent.base }}
                </router-link>
                <span class="grey--text px-4">{{ recent.dir }}</span>
              </h3>
            </div>
          </v-card>
        </v-row>
      </v-col>
    </v-container>
  </v-main>
</template>
