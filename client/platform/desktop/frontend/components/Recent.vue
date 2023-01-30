<script lang="ts">
import { join } from 'path';
import moment from 'moment';
import {
  computed, defineComponent, ref, Ref, reactive,
} from '@vue/composition-api';

import type { DatasetType, MultiCamImportArgs } from 'dive-common/apispec';
import { itemsPerPageOptions } from 'dive-common/constants';
import type { DesktopMediaImportResponse } from 'platform/desktop/constants';

import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';

import { clientSettings } from 'dive-common/store/settings';
import ImportButton from 'dive-common/components/ImportButton.vue';
import ImportMultiCamDialog from 'dive-common/components/ImportMultiCamDialog.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useRequest } from 'dive-common/use';
import { DataTableHeader } from 'vuetify';

import * as api from '../api';
import {
  JsonMetaCache, recents, removeRecents, setRecents,
} from '../store/dataset';
import {
  upgradedVersion, downgradedVersion, acknowledgeVersion, knownVersion,
} from '../store/settings';
import { setOrGetConversionJob } from '../store/jobs';
import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';
import ImportDialog from './ImportDialog.vue';


export default defineComponent({
  components: {
    BrowserLink,
    ImportButton,
    ImportDialog,
    NavigationBar,
    ImportMultiCamDialog,
    TooltipBtn,
  },

  setup(_, { root }) {
    const importMultiCamDialog = ref(false);
    const calibration = ref(false);
    const pendingImportPayload: Ref<DesktopMediaImportResponse | null> = ref(null);
    const searchText: Ref<string | null> = ref('');
    const stereo = ref(false);
    const multiCamOpenType: Ref<'image-sequence'|'video'> = ref('image-sequence');
    const importing = ref(false);
    const { prompt } = usePrompt();
    const {
      error, loading: checkingMedia, request, reset: resetError,
    } = useRequest();

    async function open(dstype: DatasetType | 'text', directory = false) {
      const ret = await api.openFromDisk(dstype, directory);
      if (!ret.canceled) {
        pendingImportPayload.value = await request(() => api.importMedia(ret.filePaths[0]));
      }
    }

    /** Accept args from the dialog, as it may have modified some parts */
    async function finalizeImport(args: DesktopMediaImportResponse) {
      importing.value = true;
      await request(async () => {
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
      });
      importing.value = false;
    }

    function openMultiCamDialog(args: {stereo: boolean; openType: 'image-sequence' | 'video'; calibration: boolean}) {
      stereo.value = args.stereo;
      calibration.value = args.calibration;
      multiCamOpenType.value = args.openType;
      importMultiCamDialog.value = true;
    }

    async function multiCamImport(args: MultiCamImportArgs) {
      importMultiCamDialog.value = false;
      pendingImportPayload.value = await request(() => api.importMultiCam(args));
    }

    async function confirmDeleteDataset(datasetId: string, datasetName: string) {
      const result = await prompt({
        title: 'Warning Deleting Dataset',
        text: [`Do you want to delete dataset ${datasetName}?`,
          '1.  Deleting dataset will not remove source media, such as images or video.',
          '2.  It will not remove annotations files that were imported when the dataset was created.',
          '3.  This will remove any annotations that bave been created in DIVE for this dataset',
          '4.  Use the Export button for the dataset to create a copy of the last set of annotations'],
        confirm: true,
      });
      if (!result) {
        return;
      }
      await request(() => api.deleteDataset(datasetId));
      //Now we need to update recents by removing the dataset from localStorage
      removeRecents(datasetId);
    }


    const filteredRecents = computed(() => recents.value
      .filter((v) => v.name.toLowerCase().indexOf((searchText.value || '').toLowerCase()) >= 0));
    function getTypeIcon(recent: JsonMetaCache) {
      if (recent.subType) {
        if (recent.subType === 'stereo') {
          return 'mdi-binoculars';
        } if (recent.subType === 'multicam') {
          return 'mdi-camera-burst';
        }
      }
      if (recent.type === 'video') {
        return 'mdi-file-video';
      }
      if (recent.imageListPath) {
        return 'mdi-view-list-outline';
      }
      return 'mdi-image-multiple';
    }

    async function preloadCheck(recent: JsonMetaCache) {
      //Attempts to preload the data to see if there are any isues
      try {
        await api.checkDataset(recent.id);
      } catch (e) {
        await prompt({
          title: 'Error Loading Data',
          text: [
            `There was an error loading data from ${recent.name}`,
            'Correct the error using the Error Details or delete and re-import the dataset',
            String(e),
          ],
          positiveButton: 'Okay',
        });
        return;
      }
      root.$router.push({ name: 'viewer', params: { id: recent.id } });
    }

    const headers: DataTableHeader[] = [
      {
        text: 'Type',
        value: 'type',
        sortable: false,
        width: 40,
      },
      {
        text: 'Name',
        value: 'name',
        sortable: true,
      },
      {
        text: 'Accessed',
        value: 'accessedAt',
        sortable: true,
        sort: (a: string, b: string) => Date.parse(b) - Date.parse(a),
        width: 140,
      },
      {
        text: '',
        value: 'delete',
        sortable: false,
        width: 40,
      },
    ];
    const toDisplayString = (dateString: string) => moment(dateString).format('MM/DD/YY HH:mm');

    return {
      // methods
      acknowledgeVersion,
      open,
      finalizeImport,
      multiCamImport,
      join,
      setOrGetConversionJob,
      openMultiCamDialog,
      getTypeIcon,
      importMedia: api.importMedia,
      confirmDeleteDataset,
      preloadCheck,
      toDisplayString,
      resetError,
      // state
      multiCamOpenType,
      stereo,
      filteredRecents,
      pendingImportPayload,
      searchText,
      error,
      importing,
      importMultiCamDialog,
      headers,
      upgradedVersion,
      downgradedVersion,
      knownVersion,
      checkingMedia,
      clientSettings,
      itemsPerPageOptions,
      calibration,
    };
  },
});
</script>

<template>
  <v-main>
    <v-dialog
      :value="pendingImportPayload !== null || importMultiCamDialog || checkingMedia"
      persistent
      width="800"
      overlay-opacity="0.95"
      max-width="80%"
    >
      <ImportDialog
        v-if="pendingImportPayload !== null"
        :import-data="pendingImportPayload"
        :disabled="importing"
        @finalize-import="finalizeImport($event)"
        @abort="pendingImportPayload = null"
      />
      <ImportMultiCamDialog
        v-else-if="importMultiCamDialog"
        :stereo="stereo"
        :data-type="multiCamOpenType"
        :import-media="importMedia"
        :calibration="calibration"
        @begin-multicam-import="multiCamImport($event)"
        @abort="importMultiCamDialog = false"
      />
      <v-card
        v-else-if="checkingMedia"
        outlined
      >
        <v-card-title class="text-h5">
          Calculating...
          <v-progress-linear
            indeterminate
            color="light-blue"
          />
        </v-card-title>
      </v-card>
    </v-dialog>
    <navigation-bar />
    <v-container>
      <v-col>
        <v-alert
          v-if="upgradedVersion"
          color="success darken-2"
          dismissible
          @input="acknowledgeVersion"
        >
          <h2>
            Upgraded to DIVE Desktop Release {{ upgradedVersion }}
          </h2>
          Read the
          <BrowserLink
            href="https://github.com/Kitware/dive/releases"
            display="inline"
          >
            release logs
          </BrowserLink>
          to find out what's new.
        </v-alert>
        <v-alert
          v-if="downgradedVersion"
          type="warning"
          color="warning darken-1"
        >
          <h3>
            Downgrade detected
          </h3>
          You're using {{ downgradedVersion }}, but a newer version
          {{ knownVersion }} has been launched before.  Downgrading is not recommended.
        </v-alert>
        <v-row>
          <v-col
            md="6"
            sm="6"
          >
            <h1 class="text-h3 mb-4 font-weight-light">
              DIVE Annotation Tool
            </h1>
            <h3>Useful Links</h3>
            <div>
              <BrowserLink
                display="inline"
                href="https://kitware.github.io/dive/"
              >
                User Guide
              </BrowserLink>
            </div>
            <div>
              <BrowserLink
                display="inline"
                href="https://viame.kitware.com/#/collection/5e4c256ca0fc86aa03120c34"
              >
                Public example data
              </BrowserLink>
            </div>
            <div>
              <BrowserLink
                display="inline"
                href="https://viametoolkit.org/"
              >
                viametoolkit.org
              </BrowserLink>
            </div>
          </v-col>
          <v-col
            md="6"
            sm="6"
          >
            <ImportButton
              name="Open Image Sequence"
              icon="mdi-folder-open"
              open-type="image-sequence"
              class="my-3"
              :multi-cam-import="true"
              @open="open($event)"
              @multi-cam="openMultiCamDialog"
            />
            <ImportButton
              name="Open Video"
              icon="mdi-file-video"
              open-type="video"
              class="my-3"
              :multi-cam-import="true"
              @open="open($event)"
              @multi-cam="openMultiCamDialog"
            />
          </v-col>
        </v-row>
        <v-row>
          <v-card
            class="px-4 py-2 my-4"
            min-width="100%"
          >
            <div
              v-if="filteredRecents.length > 0 || searchText"
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
            <v-data-table
              dense
              v-bind="{ headers: headers, items: filteredRecents }"
              sort-by="accessedAt"
              :footer-props="{ itemsPerPageOptions }"
              :items-per-page.sync="clientSettings.rowsPerPage"
              no-data-text="No data loaded"
            >
              <template #[`item.type`]="{ item }">
                <tooltip-btn
                  :key="item.id"
                  class="pr-2"
                  color="primary lighten-2"
                  :tooltip-text="item.subType ? item.subType : item.type"
                  :icon="getTypeIcon(item)"
                  @click="preloadCheck(item)"
                />
              </template>
              <template #[`item.name`]="{ item }">
                <span :key="item.id">
                  <div v-if="setOrGetConversionJob(item.id)">
                    <span class="primary--text text--darken-1 text-subtitle-1 pt-1">
                      {{ item.name }}
                    </span>
                    <span class="pl-4">
                      Converting
                      <v-icon>
                        mdi-spin mdi-sync
                      </v-icon>
                    </span>
                  </div>
                  <div
                    v-else
                    class="link primary--text text--lighten-3 text-subtitle-1 pt-1"
                    style="line-height: initial;"
                    @click="preloadCheck(item)"
                  >
                    {{ item.name }}
                  </div>
                  <div class="grey--text text-caption">
                    {{
                      item.imageListPath
                        || item.originalBasePath
                        || 'Data imported from several locations'
                    }}
                  </div>
                </span>
              </template>
              <template #[`item.accessedAt`]="{ item }">
                <span
                  :key="item.id"
                  class="grey--text text-body-2"
                >
                  {{ toDisplayString(item.accessedAt) }}
                </span>
              </template>
              <template #[`item.delete`]="{ item }">
                <tooltip-btn
                  :key="item.id"
                  color="error"
                  icon="mdi-delete"
                  :tooltip-text="'Delete'"
                  @click="confirmDeleteDataset(item.id, item.name)"
                />
              </template>
            </v-data-table>
          </v-card>
        </v-row>
      </v-col>
    </v-container>
    <v-snackbar
      :value="error !== null"
      :timeout="-1"
      color="error"
    >
      {{ error }}
      <template v-slot:action="{ attrs }">
        <v-btn
          text
          v-bind="attrs"
          @click="resetError"
        >
          Close
        </v-btn>
      </template>
    </v-snackbar>
  </v-main>
</template>

<style lang="scss">
.icon-col {
  max-width: 40px;
}
.link {
  &:hover{
    cursor: pointer;
    text-decoration: underline;
  }
}
</style>
