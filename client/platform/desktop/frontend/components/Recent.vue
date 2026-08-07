<script lang="ts">
import moment from 'moment';
import {
  computed, defineComponent, ref, Ref, watch,
} from 'vue';

import type { DatasetType, MultiCamImportArgs } from 'dive-common/apispec';
import { itemsPerPageOptions } from 'dive-common/constants';
import { JobType, DesktopMediaImportResponse, Job } from 'platform/desktop/constants';

import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';

import { clientSettings } from 'dive-common/store/settings';
import ImportButton from 'dive-common/components/ImportButton.vue';
import ImportMultiCamDialog from 'dive-common/components/ImportMultiCamDialog.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useRequest } from 'dive-common/use';
import { DataTableHeader } from 'vuetify';

import { useRouter } from 'vue-router/composables';
import * as api from '../api';
import {
  JsonMetaCache, recents, removeRecents, setRecents,
} from '../store/dataset';
import {
  settings,
  upgradedVersion, downgradedVersion, acknowledgeVersion, knownVersion,
} from '../store/settings';
import { setOrGetConversionJob, cpuJobQueue, queuedCpuJobs } from '../store/jobs';
import BrowserLink from './BrowserLink.vue';
import DatasetSourceInfo from './DatasetSourceInfo.vue';
import NavigationBar from './NavigationBar.vue';
import ImportDialog from './ImportDialog.vue';
import BulkImportDialog from './BulkImportDialog.vue';
import ImportMultiCamBatchDialog from './ImportMultiCamBatchDialog.vue';

export default defineComponent({
  components: {
    BrowserLink,
    DatasetSourceInfo,
    ImportButton,
    ImportDialog,
    BulkImportDialog,
    NavigationBar,
    ImportMultiCamDialog,
    ImportMultiCamBatchDialog,
    TooltipBtn,
  },

  setup() {
    const router = useRouter();
    const importMultiCamDialog = ref(false);
    const importMultiCamBatchDialog = ref(false);
    const pendingImportPayload: Ref<DesktopMediaImportResponse[] | null> = ref(null);
    const bulkImport = ref(false);
    const searchText: Ref<string | null> = ref('');
    const stereo = ref(false);
    const multiCamOpenType: Ref<'image-sequence'|'video'> = ref('image-sequence');
    const importing = ref(false);
    const { prompt } = usePrompt();
    const {
      error, loading: checkingMedia, request, reset: resetError,
    } = useRequest();

    async function open(dstype: DatasetType | 'bulk' | 'text', directory = false) {
      bulkImport.value = false;

      const ret = await api.openFromDisk(dstype, directory);
      if (ret.canceled) {
        return;
      }

      if (dstype !== 'bulk') {
        pendingImportPayload.value = [await request(() => api.importMedia(ret.filePaths[0]))];
        return;
      }

      bulkImport.value = true;
      const foundImports = await request(() => api.bulkImportMedia(ret.filePaths[0]));
      if (!foundImports.length) {
        prompt({ title: 'No datasets found', text: 'Please check that your import path is correct and try again.', positiveButton: 'Okay' });
        pendingImportPayload.value = null;
        return;
      }

      pendingImportPayload.value = foundImports;
    }

    /** Accept args from the dialog, as it may have modified some parts */
    async function finalizeBulkImport(argsArray: DesktopMediaImportResponse[]) {
      importing.value = true;

      // Apply native video playback setting to video imports
      const argsWithSettings = argsArray.map((args) => ({
        ...args,
        useNativePlayback: args.jsonMeta.type === 'video'
          && (settings.value?.nativeVideoPlayback ?? false),
      }));

      const imports = await request(async () => Promise.all(
        argsWithSettings.map((args) => api.finalizeImport(args)),
      ));
      pendingImportPayload.value = null;

      imports.forEach(async (conversionArgs) => {
        // Queue conversion job
        if (conversionArgs.mediaList.length > 0) {
          await api.convert(conversionArgs);
        }
        const recentsMeta = await api.loadMetadata(conversionArgs.meta.id);
        setRecents(recentsMeta);
      });

      importing.value = false;
    }

    /** Accept args from the dialog, as it may have modified some parts */
    async function finalizeImport(args: DesktopMediaImportResponse) {
      importing.value = true;
      await request(async () => {
        // Apply native video playback setting to video imports
        const argsWithSettings: DesktopMediaImportResponse = {
          ...args,
          useNativePlayback: args.jsonMeta.type === 'video'
            && (settings.value?.nativeVideoPlayback ?? false),
        };
        const conversionArgs = await api.finalizeImport(argsWithSettings);
        pendingImportPayload.value = null; // close dialog
        if (conversionArgs.mediaList.length === 0) {
          router.push({
            name: 'viewer',
            params: { id: conversionArgs.meta.id },
          });
        } else {
          // Queue conversion job
          await api.convert(conversionArgs);
          // Display new data and await transcoding to complete
          const recentsMeta = await api.loadMetadata(conversionArgs.meta.id);
          setRecents(recentsMeta);
        }
      });
      importing.value = false;
    }

    const queuedConversionDatasetIds = ref([] as string[]);
    watch(() => queuedCpuJobs, () => {
      queuedConversionDatasetIds.value = [];
      cpuJobQueue.jobSpecs.forEach((spec: Job) => {
        if (spec.type === JobType.Conversion) {
          queuedConversionDatasetIds.value.push(spec.meta.id);
        }
      });
    }, { deep: true });

    function openMultiCamDialog(args: {stereo: boolean; openType: 'image-sequence' | 'video'}) {
      stereo.value = args.stereo;
      multiCamOpenType.value = args.openType;
      importMultiCamDialog.value = true;
    }

    async function multiCamImport(args: MultiCamImportArgs) {
      importMultiCamDialog.value = false;
      pendingImportPayload.value = [await request(() => api.importMultiCam(args))];
    }

    const selectedRecents = ref([] as JsonMetaCache[]);
    const selectedIds = computed(() => new Set(selectedRecents.value.map((item) => item.id)));

    function isSelected(item: JsonMetaCache) {
      return selectedIds.value.has(item.id);
    }

    function toggleSelected(item: JsonMetaCache) {
      if (isSelected(item)) {
        selectedRecents.value = selectedRecents.value.filter((v) => v.id !== item.id);
      } else {
        selectedRecents.value = selectedRecents.value.concat([item]);
      }
    }

    async function confirmDeleteSelected() {
      const items = selectedRecents.value;
      if (items.length === 0) {
        return;
      }
      const result = await prompt({
        title: `Delete ${items.length} dataset${items.length > 1 ? 's' : ''}`,
        text: ['Do you want to delete the selected datasets?',
          '1.  Deleting datasets will not remove source media, such as images or video.',
          '2.  It will not remove annotations files that were imported when the datasets were created.',
          '3.  This will remove any annotations that have been created in DIVE for these datasets',
          '4.  Use the Export button for a dataset to create a copy of the last set of annotations'],
        positiveButton: 'Delete',
        negativeButton: 'Cancel',
        confirm: true,
      });
      if (!result) {
        return;
      }
      // Deletions run sequentially so a failure stops before touching the rest
      // eslint-disable-next-line no-restricted-syntax
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop
        await request(() => api.deleteDataset(item.id));
        removeRecents(item.id);
      }
      selectedRecents.value = [];
    }

    const filteredRecents = computed(() => recents.value
      .filter((v) => v.name.toLowerCase().indexOf((searchText.value || '').toLowerCase()) >= 0));
    const allSelected = computed(() => filteredRecents.value.length > 0
      && filteredRecents.value.every((item) => selectedIds.value.has(item.id)));
    const someSelected = computed(() => filteredRecents.value.some(
      (item) => selectedIds.value.has(item.id),
    ));

    function toggleSelectAll() {
      if (allSelected.value) {
        selectedRecents.value = [];
      } else {
        selectedRecents.value = filteredRecents.value.slice();
      }
    }

    function selectedIdsQuery() {
      return { datasetIds: selectedRecents.value.map((item) => item.id).join(',') };
    }

    function runPipelineOnSelected() {
      router.push({ name: 'pipeline', query: selectedIdsQuery() });
    }

    function runTrainingOnSelected() {
      router.push({ name: 'training', query: selectedIdsQuery() });
    }
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
      if (recent.type === 'large-image') {
        return 'mdi-map';
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
        const recentsMeta = await api.loadMetadata(recent.id);
        setRecents(recentsMeta);
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
      router.push({ name: 'viewer', params: { id: recent.id } });
    }

    function parseRecentDate(value: string) {
      if (!value) {
        return moment.invalid();
      }
      const normalized = value.replace(/\s+\([^)]*\)$/, '');
      return moment(normalized, [moment.ISO_8601, moment.RFC_2822, 'ddd MMM DD YYYY HH:mm:ss [GMT]ZZ'], true);
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
        sort: (a: string, b: string) => parseRecentDate(b).valueOf() - parseRecentDate(a).valueOf(),
        width: 140,
      },
      {
        text: '',
        value: 'select',
        sortable: false,
        width: 40,
      },
    ];
    const toDisplayString = (dateString: string) => {
      const parsed = parseRecentDate(dateString);
      return parsed.isValid() ? parsed.format('MM/DD/YY HH:mm') : dateString;
    };

    return {
      // methods
      acknowledgeVersion,
      open,
      finalizeBulkImport,
      finalizeImport,
      multiCamImport,
      setOrGetConversionJob,
      openMultiCamDialog,
      getTypeIcon,
      importMedia: api.importMedia,
      confirmDeleteSelected,
      runPipelineOnSelected,
      runTrainingOnSelected,
      isSelected,
      toggleSelected,
      toggleSelectAll,
      preloadCheck,
      toDisplayString,
      resetError,
      // state
      multiCamOpenType,
      stereo,
      filteredRecents,
      selectedRecents,
      allSelected,
      someSelected,
      pendingImportPayload,
      bulkImport,
      searchText,
      error,
      importing,
      importMultiCamDialog,
      importMultiCamBatchDialog,
      headers,
      upgradedVersion,
      downgradedVersion,
      knownVersion,
      checkingMedia,
      clientSettings,
      itemsPerPageOptions,
      queuedConversionDatasetIds,
    };
  },
});
</script>

<template>
  <v-main>
    <v-dialog
      persistent
      overlay-opacity="0.95"
      max-width="80%"
      width="800"
      :value="checkingMedia || importMultiCamDialog"
    >
      <v-card v-if="checkingMedia" outlined>
        <v-card-title class="text-h5">
          {{ bulkImport ? 'Importing...' : 'Calculating...' }}
          <v-progress-linear
            indeterminate
            color="light-blue"
          />
        </v-card-title>
      </v-card>
      <ImportMultiCamDialog
        v-else-if="importMultiCamDialog"
        :stereo="stereo"
        :data-type="multiCamOpenType"
        :enable-subfolder-import="true"
        :enable-transform-import="true"
        :import-media="importMedia"
        @begin-multicam-import="multiCamImport($event)"
        @abort="importMultiCamDialog = false"
      />
    </v-dialog>
    <v-dialog
      :value="importMultiCamBatchDialog"
      persistent
      overlay-opacity="0.95"
      max-width="80%"
      width="1000"
    >
      <ImportMultiCamBatchDialog
        v-if="importMultiCamBatchDialog"
        @abort="importMultiCamBatchDialog = false"
      />
    </v-dialog>
    <v-dialog
      :value="pendingImportPayload !== null"
      persistent
      :width="bulkImport ? '1400' : '800'"
      overlay-opacity="0.95"
      max-width="80%"
    >
      <template v-if="pendingImportPayload !== null">
        <BulkImportDialog
          v-if="bulkImport"
          :import-data="pendingImportPayload"
          @finalize-import="finalizeBulkImport($event)"
          @abort="pendingImportPayload = null"
        />
        <ImportDialog
          v-else
          :import-data="pendingImportPayload[0]"
          :disabled="importing"
          @finalize-import="finalizeImport($event)"
          @abort="pendingImportPayload = null"
        />
      </template>
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
              name="Bulk Import"
              icon="mdi-folder-multiple"
              open-type="bulk"
              class="my-3"
              :bulk-import="true"
              @open="open($event)"
              @multi-cam-batch="importMultiCamBatchDialog = true"
            />
            <ImportButton
              name="Open Image Sequence"
              icon="mdi-folder-open"
              open-type="image-sequence"
              class="my-3"
              :multi-cam-import="true"
              :large-image-import="true"
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
              <template v-if="selectedRecents.length > 0">
                <v-tooltip bottom>
                  <template #activator="{ on }">
                    <v-btn
                      class="align-self-center"
                      color="primary"
                      outlined
                      small
                      v-on="on"
                      @click="runPipelineOnSelected"
                    >
                      <v-icon
                        left
                        small
                      >
                        mdi-play
                      </v-icon>
                      Run Pipeline
                    </v-btn>
                  </template>
                  <span>Run a pipeline on the selected datasets</span>
                </v-tooltip>
                <v-tooltip bottom>
                  <template #activator="{ on }">
                    <v-btn
                      class="ml-2 align-self-center"
                      color="primary"
                      outlined
                      small
                      v-on="on"
                      @click="runTrainingOnSelected"
                    >
                      <v-icon
                        left
                        small
                      >
                        mdi-brain
                      </v-icon>
                      Run Training
                    </v-btn>
                  </template>
                  <span>Train a model on the selected datasets</span>
                </v-tooltip>
                <v-tooltip bottom>
                  <template #activator="{ on }">
                    <v-btn
                      class="ml-2 align-self-center"
                      color="error"
                      outlined
                      small
                      v-on="on"
                      @click="confirmDeleteSelected"
                    >
                      <v-icon
                        left
                        small
                      >
                        mdi-delete
                      </v-icon>
                      Delete ({{ selectedRecents.length }})
                    </v-btn>
                  </template>
                  <span>Delete all selected datasets</span>
                </v-tooltip>
              </template>
              <v-text-field
                v-model="searchText"
                dense
                outlined
                clearable
                hide-details
                placeholder="search"
                class="shrink ml-4"
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
              item-key="id"
              :footer-props="{ itemsPerPageOptions }"
              :items-per-page.sync="clientSettings.rowsPerPage"
              no-data-text="No data loaded"
            >
              <template #[`header.select`]>
                <v-simple-checkbox
                  :value="allSelected"
                  :indeterminate="someSelected && !allSelected"
                  :ripple="false"
                  @input="toggleSelectAll"
                />
              </template>
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
                  <div v-else-if="item.error">
                    <span
                      class="error--text text-subtitle-1 pt-1 link"
                      @click="preloadCheck(item)"
                    >
                      {{ item.name }}
                    </span>
                    <v-tooltip bottom>
                      <template #activator="{ on, attrs }">
                        <v-icon
                          v-bind="attrs"
                          color="error"
                          v-on="on"
                        >
                          mdi-alert-circle
                        </v-icon>
                      </template>
                      <span>{{ item.error }}</span>
                    </v-tooltip>
                  </div>
                  <div v-else-if="queuedConversionDatasetIds.includes(item.id)">
                    <span class="primary--text text--darken-1 text-subtitle-1 pt-1">
                      {{ item.name }}
                    </span>
                    <v-chip small>
                      Awaiting Conversion
                      <v-icon right>
                        mdi-sync mdi-spin
                      </v-icon>
                    </v-chip>
                  </div>
                  <div
                    v-else
                    class="link primary--text text--lighten-3 text-subtitle-1 pt-1"
                    style="line-height: initial;"
                    @click="preloadCheck(item)"
                  >
                    {{ item.name }}
                  </div>
                  <div class="grey--text text-caption d-flex align-center">
                    <dataset-source-info
                      :dataset-id="item.id"
                      class="flex-shrink-0 mr-1"
                    />
                    <span>
                      {{
                        item.imageListPath
                          || item.originalBasePath
                          || 'Data imported from several locations'
                      }}
                    </span>
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
              <template #[`item.select`]="{ item }">
                <v-simple-checkbox
                  :key="item.id"
                  :value="isSelected(item)"
                  :ripple="false"
                  @input="toggleSelected(item)"
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
      <template #action="{ attrs }">
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
