<script lang="ts">
import { join } from 'path';
import {
  computed, defineComponent, ref, Ref,
} from '@vue/composition-api';

import type { DatasetType } from 'dive-common/apispec';
import type { MediaImportPayload, MultiCamImportFolderArgs, MultiCamImportKeywordArgs } from 'platform/desktop/constants';

import * as api from '../api';
import { recents, setRecents } from '../store/dataset';
import { setOrGetConversionJob } from '../store/jobs';
import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';
import ImportDialog from './ImportDialog.vue';
import ImportMultiCamDialog from './ImportMultiCamDialog.vue';


export default defineComponent({
  components: {
    BrowserLink,
    ImportDialog,
    NavigationBar,
    ImportMultiCamDialog,
  },

  setup(_, { root }) {
    const snackbar = ref(false);
    const importMultiCamDialog = ref(false);
    const pageSize = 12; // Default 12 looks good on default width/height of window
    const limit = ref(pageSize);
    const errorText = ref('');
    const pendingImportPayload: Ref<MediaImportPayload | null> = ref(null);
    const searchText: Ref<string | null> = ref('');

    async function open(dstype: DatasetType) {
      const ret = await api.openFromDisk(dstype);
      if (!ret.canceled) {
        try {
          pendingImportPayload.value = await api.importMedia(ret.filePaths[0]);
        } catch (err) {
          snackbar.value = true;
          errorText.value = err.message;
        }
      }
    }

    /** Accept args from the dialog, as it may have modified some parts */
    async function finalizeImport(args: MediaImportPayload) {
      try {
        const jsonMeta = await api.finalizeImport(args);
        pendingImportPayload.value = null; // close dialog
        if (!jsonMeta.transcodingJobKey) {
          root.$router.push({
            name: 'viewer',
            params: { id: jsonMeta.id },
          });
        } else {
          // Display new data and await transcoding to complete
          const recentsMeta = await api.loadMetadata(jsonMeta.id);
          setRecents(recentsMeta);
        }
      } catch (err) {
        snackbar.value = true;
        errorText.value = err.message;
      }
    }

    async function multiCamImport(args: MultiCamImportFolderArgs | MultiCamImportKeywordArgs) {
      importMultiCamDialog.value = false;
      try {
        pendingImportPayload.value = await api.importMultiCam(args);
      } catch (err) {
        snackbar.value = true;
        errorText.value = err.message;
      }
    }

    const filteredRecents = computed(() => recents.value
      .filter((v) => v.name.toLowerCase().indexOf((searchText.value || '').toLowerCase()) >= 0));
    const paginatedRecents = computed(() => (filteredRecents.value.slice(0, limit.value)));
    const totalRecents = computed(() => filteredRecents.value.length);

    function toggleMore() {
      if (limit.value < recents.value.length) {
        limit.value = recents.value.length;
      } else {
        limit.value = pageSize;
      }
    }

    return {
      // methods
      open,
      finalizeImport,
      multiCamImport,
      join,
      setOrGetConversionJob,
      toggleMore,
      // state
      pageSize,
      limit,
      paginatedRecents,
      pendingImportPayload,
      totalRecents,
      searchText,
      snackbar,
      errorText,
      importMultiCamDialog,
    };
  },
});
</script>

<template>
  <v-main>
    <v-dialog
      :value="pendingImportPayload !== null || importMultiCamDialog"
      persistent
      width="800"
      overlay-opacity="0.95"
      max-width="80%"
    >
      <ImportDialog
        v-if="pendingImportPayload !== null"
        :import-data="pendingImportPayload"
        @finalize-import="finalizeImport($event)"
        @abort="pendingImportPayload = null"
      />
      <ImportMultiCamDialog
        v-if="importMultiCamDialog"
        :stereo="true"
        @begin-multicam-import="multiCamImport($event)"
        @abort="importMultiCamDialog = false"
      />
    </v-dialog>
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
            <div>
              <browser-link
                display="inline"
                href="https://kitware.github.io/dive/"
              >
                User Guide
              </browser-link>
            </div>
            <div>
              <browser-link
                display="inline"
                href="https://viame.kitware.com/#/collection/5e4c256ca0fc86aa03120c34"
              >
                Public example data
              </browser-link>
            </div>
            <div>
              <browser-link
                display="inline"
                href="https://viametoolkit.org/"
              >
                viametoolkit.org
              </browser-link>
            </div>
          </v-col>
          <v-col
            md="4"
            sm="6"
          >
            <v-menu offset-y>
              <template v-slot:activator="{ on }">
                <v-btn
                  large
                  block
                  color="primary"
                  class="mb-6 mr-0 pr-0"
                  @click="open('image-sequence')"
                >
                  <div class="col-11">
                    Open Image Sequence
                    <v-icon class="ml-2">
                      mdi-folder-open
                    </v-icon>
                  </div>
                  <v-icon
                    class="justify-right my-auto"
                    style="float:right; border-left: 1px solid white;"
                    v-on="on"
                  >
                    mdi-chevron-down
                  </v-icon>
                </v-btn>
              </template>
              <v-list>
                <v-list-item>
                  <v-btn
                    block
                    color="primary"
                    @click="importMultiCamDialog = true"
                  >
                    Stereoscopic
                    <v-icon>
                      mdi-binoculars
                    </v-icon>
                  </v-btn>
                </v-list-item>
              </v-list>
            </v-menu>
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
            <div
              v-if="totalRecents > 0 || searchText"
              class="d-flex flex-row"
            >
              <div class="text-h4 font-weight-light mb-2">
                Recent
              </div>
              <v-spacer />
              <v-text-field
                v-model="searchText"
                dense
                outlined
                clearable
                hide-details
                placeholder="search"
                class="shrink"
                color="grey darken-1"
              >
                <template #append>
                  <v-icon
                    color="grey darken-1"
                  >
                    mdi-magnify
                  </v-icon>
                </template>
              </v-text-field>
            </div>
            <h2
              v-else
              class="text-h4 font-weight-light mb-2"
            >
              Open images or video to get started
            </h2>
            <div
              v-for="recent in paginatedRecents"
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
                      : 'mdi-image-multiple'
                  }}
                </v-icon>
                <v-icon v-if="recent.stereoscopic">
                  mdi-binoculars
                </v-icon>
                <span v-if="setOrGetConversionJob(recent.id)">
                  <span class="primary--text text--darken-1 text-decoration-none">
                    {{ recent.name }}
                  </span>
                  <span class="pl-4">
                    Converting
                    <v-icon>
                      mdi-spin mdi-sync
                    </v-icon>
                  </span>
                </span>
                <router-link
                  v-else
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
            <div
              v-if="pageSize < totalRecents"
              class="mx-1"
            >
              <v-divider class="my-2" />
              <h3
                class="text-body-1"
                style="cursor: pointer;"
                @click="toggleMore"
              >
                <v-icon
                  class="pr-2"
                  color="primary lighten-3"
                >
                  {{ (limit === totalRecents) ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
                </v-icon>
                <span
                  class="primary--text text--lighten-3"
                >
                  <span v-if="limit < totalRecents">
                    Show {{ totalRecents - pageSize }} more
                  </span>
                  <span v-else>
                    Show less
                  </span>
                </span>
              </h3>
            </div>
          </v-card>
        </v-row>
      </v-col>
    </v-container>
    <v-snackbar
      v-model="snackbar"
      :timeout="-1"
      color="error"
    >
      {{ errorText }}
      <template v-slot:action="{ attrs }">
        <v-btn
          text
          v-bind="attrs"
          @click="snackbar = false"
        >
          Close
        </v-btn>
      </template>
    </v-snackbar>
  </v-main>
</template>
