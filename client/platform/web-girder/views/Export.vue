<!-- eslint-disable vue/no-ref-as-operand -->
<script lang="ts">
import {
  computed, defineComponent, ref, shallowRef, toRef, watch, PropType, Ref,
} from 'vue';
import {
  usePendingSaveCount, useHandler, useTrackFilters, useRevisionId,
} from 'vue-media-annotator/provides';
import AutosavePrompt from 'dive-common/components/AutosavePrompt.vue';
import { useRequest } from 'dive-common/use';
import {
  DatasetSourceMedia, getDataset, getDatasetMedia, getUri,
} from 'platform/web-girder/api';
import { GirderMetadataStatic } from 'platform/web-girder/constants';
import {
  ImageSequenceType, LargeImageType, MultiType, VideoType,
} from 'dive-common/constants';

export default defineComponent({
  components: { AutosavePrompt },

  props: {
    datasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    fileIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    blockOnUnsaved: {
      type: Boolean,
      default: false,
    },
    buttonOptions: {
      type: Object,
      default: () => ({}),
    },
    menuOptions: {
      type: Object,
      default: () => ({}),
    },
  },

  setup(props) {
    const savePrompt = ref(false);
    let currentSaveUrl = '';

    /** State populated from provides if the dialog exists inside a viewer context */
    let save = () => Promise.resolve();
    let pendingSaveCount = ref(0);
    let checkedTypes = ref([] as readonly string[]);
    let revisionId = ref(null as null | number);
    if (props.blockOnUnsaved) {
      save = useHandler().save;
      pendingSaveCount = usePendingSaveCount();
      checkedTypes = useTrackFilters().checkedTypes;
      revisionId = useRevisionId();
    }

    async function doExport({ forceSave = false, url }: { url?: string; forceSave?: boolean }) {
      if (pendingSaveCount.value > 0 && forceSave) {
        try {
          await save();
        } finally {
          savePrompt.value = false;
        }
      } else if (pendingSaveCount.value > 0 && url) {
        savePrompt.value = true;
        currentSaveUrl = url;
        return;
      }
      if (url) {
        window.location.assign(url);
      } else if (forceSave && currentSaveUrl) {
        window.location.assign(currentSaveUrl);
      } else {
        throw new Error('Expected either url OR forceSave and currentSaveUrl');
      }
    }

    const isDownloadButtonDisplayed = computed(() => {
      const datasetsSelected = props.datasetIds.length > 0;
      const filesSelected = props.fileIds.length > 0;

      return datasetsSelected !== filesSelected;
    });

    const isDatasetDownload = computed(() => props.datasetIds.length > 0 && props.fileIds.length === 0);
    const isFilesDownload = computed(() => props.fileIds.length > 0 && props.datasetIds.length === 0);

    const menuOpen = ref(false);
    const excludeBelowThreshold = ref(true);
    const excludeUncheckedTypes = ref(false);

    const singleDataSetId: Ref<string|null> = ref(null);
    const dataset = shallowRef(null as GirderMetadataStatic | null);
    const datasetMedia = shallowRef(null as DatasetSourceMedia | null);
    const { request, error } = useRequest();
    const loadDatasetMeta = () => request(async () => {
      if (props.datasetIds.length > 1) {
        singleDataSetId.value = null;
        dataset.value = null;
      } else {
        [singleDataSetId.value] = props.datasetIds;
      }
      if (menuOpen.value && singleDataSetId.value) {
        dataset.value = (await getDataset(singleDataSetId.value)).data;
        if (dataset.value.type === 'video') {
          datasetMedia.value = (await getDatasetMedia(singleDataSetId.value)).data;
        }
      }
    });
    watch([toRef(props, 'datasetIds'), menuOpen], loadDatasetMeta);

    const exportUrls = computed(() => {
      const params = {
        excludeBelowThreshold: excludeBelowThreshold.value,
        typeFilter: excludeUncheckedTypes.value ? JSON.stringify(checkedTypes.value) : undefined,
      };
      if (props.fileIds.length > 0) {
        if (props.fileIds.length === 1) {
          return {
            exportAllUrl: getUri({
              url: `item/${props.fileIds[0]}/download`,
            }),
          };
        }
        return {
          exportAllUrl: getUri({
            url: 'resource/download',
            params: {
              resources: JSON.stringify({ item: props.fileIds }),
            },
          }),
        };
      }
      if (singleDataSetId.value) {
        return {
          exportAllUrl: getUri({
            url: 'dive_dataset/export',
            params: {
              ...params,
              folderIds: JSON.stringify([singleDataSetId.value]),
            },
          }),
          exportMediaUrl: dataset.value?.type === 'video'
            ? datasetMedia.value?.video?.url
            : getUri({
              url: 'dive_dataset/export',
              params: {
                ...params,
                includeDetections: false,
                includeMedia: true,
                folderIds: JSON.stringify([singleDataSetId.value]),
              },
            }),
          exportDetectionsUrl: getUri({
            url: 'dive_annotation/export',
            params: {
              ...params,
              folderId: singleDataSetId.value,
              revisionId: revisionId.value,
            },
          }),
          exportDetectionsUrlTrackJSON: getUri({
            url: 'dive_annotation/export',
            params: {
              ...params,
              folderId: singleDataSetId.value,
              revisionId: revisionId.value,
              format: 'dive_json',
            },
          }),
          exportConfigurationUrl: getUri({
            url: `dive_dataset/${singleDataSetId.value}/configuration`,
          }),
        };
      }
      return {
        exportAllUrl: getUri({
          url: 'dive_dataset/export',
          params: { folderIds: JSON.stringify(props.datasetIds) },

        }),
        exportAllUrlDetections: getUri({
          url: 'dive_dataset/export',
          params: {
            ...params,
            folderIds: JSON.stringify(props.datasetIds),
            includeDetections: true,
            includeMedia: false,
          },
        }),

      };
    });

    const mediaType = computed(() => {
      if (dataset.value === null) return null;
      const { type } = dataset.value;
      if (type === MultiType) throw new Error('Cannot export multicamera dataset');
      return {
        [ImageSequenceType]: 'Image Sequence',
        [VideoType]: 'Video',
        [LargeImageType]: 'Tiled Images',
      }[type];
    });

    async function prepareExport() {
      if (isFilesDownload.value) {
        menuOpen.value = false;
        await doExport({ url: exportUrls.value && exportUrls.value.exportAllUrl });
      } else {
        menuOpen.value = true;
      }
    }

    return {
      error,
      dataset,
      mediaType,
      excludeBelowThreshold,
      excludeUncheckedTypes,
      menuOpen,
      prepareExport,
      exportUrls,
      checkedTypes,
      revisionId,
      savePrompt,
      singleDataSetId,
      doExport,
      isDownloadButtonDisplayed,
      isDatasetDownload,
      isFilesDownload,
    };
  },
});
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    :open-on-click="false"
    :nudge-width="120"
    v-bind="menuOptions"
    max-width="280"
  >
    <template #activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            class="ma-0"
            v-bind="buttonOptions"
            :disabled="!isDownloadButtonDisplayed"
            v-on="{ ...tooltipOn, ...menuOn }"

            @click="prepareExport()"
          >
            <v-icon>
              mdi-download
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
              class="pl-1"
            >
              Download
            </span>
            <v-spacer />
            <v-icon v-if="menuOptions.right && isDatasetDownload">
              mdi-chevron-right
            </v-icon>
          </v-btn>
        </template>
        <span v-if="isDatasetDownload">Download media and annotations</span>
        <span v-else-if="isFilesDownload">Download selected files</span>
      </v-tooltip>
    </template>
    <template>
      <AutosavePrompt
        v-model="savePrompt"
        @save="doExport({ forceSave: true })"
      />
      <v-card
        outlined
        class="downloadMenu"
      >
        <v-card-title>
          Download options
        </v-card-title>
        <v-alert
          v-if="revisionId"
          type="info"
          tile
        >
          Revision {{ revisionId }} selected
        </v-alert>
        <v-alert
          v-if="error"
          color="error"
          class="mx-2"
        >
          <p class="text-h5">
            Error
          </p>
          {{ error }}
        </v-alert>

        <template v-if="dataset !== null && mediaType !== null">
          <v-card-text class="pb-0">
            Zip all {{ mediaType }} files only
          </v-card-text>
          <v-card-actions>
            <v-btn
              depressed
              block
              target="_blank"
              rel="noopener"
              :disabled="!exportUrls.exportMediaUrl"
              :href="exportUrls.exportMediaUrl"
            >
              {{ mediaType }}
            </v-btn>
          </v-card-actions>

          <v-card-text class="pb-2">
            <div>Get latest annotation csv only</div>
            <template v-if="dataset.confidenceFilters || true">
              <v-checkbox
                v-model="excludeBelowThreshold"
                label="exclude tracks below confidence threshold"
                dense
                hide-details
              />
              <div class="pt-2">
                <span>Current thresholds:</span>
                <span
                  v-for="(val, key) in dataset.confidenceFilters"
                  :key="key"
                  class="pt-2"
                >
                  ({{ key }}, {{ val }})
                </span>
              </div>
            </template>

            <template v-if="checkedTypes.length">
              <v-checkbox
                v-model="excludeUncheckedTypes"
                label="export checked types only"
                dense
                hint="Export only the track types currently enabled in the type filter"
                persistent-hint
                class="pt-0"
              />
            </template>
          </v-card-text>

          <v-card-actions>
            <v-row>
              <v-col>
                <v-btn
                  depressed
                  block
                  :disabled="!exportUrls.exportDetectionsUrl"
                  @click="doExport({ url: exportUrls && exportUrls.exportDetectionsUrl })"
                >
                  <span
                    v-if="exportUrls.exportDetectionsUrl"
                  >VIAME CSV</span>
                  <span
                    v-else
                  >detections unavailable</span>
                </v-btn>
                <v-btn
                  depressed
                  block
                  class="mt-2"
                  :disabled="!exportUrls.exportDetectionsUrl"
                  @click="doExport({
                    url: exportUrls
                      && exportUrls.exportDetectionsUrlTrackJSON,
                  })"
                >
                  <span
                    v-if="exportUrls.exportDetectionsUrl"
                  >DIVE TrackJSON</span>
                  <span
                    v-else
                  >detections unavailable</span>
                </v-btn>
                <!-- <v-btn
              depressed
              block
              :disabled="!exportUrls.exportDetectionsUrl"
              @click="doExport({ url: exportUrls && exportUrls.exportDetectionsUrl })"
            >
              <span v-if="exportUrls.exportDetectionsUrl">annotations</span>
              <span v-else>detections unavailable</span>
            </v-btn> -->
              </v-col>
            </v-row>
          </v-card-actions>

          <v-card-text class="pb-0">
            Export the dataset configuration, including
            attribute definitions, types, styles, and thresholds.
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed
              block
              @click="doExport({ url: exportUrls && exportUrls.exportConfigurationUrl })"
            >
              Configuration
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
              @click="doExport({ url: exportUrls && exportUrls.exportAllUrl })"
            >
              Everything
            </v-btn>
          </v-card-actions>
        </template>
        <template v-else-if="exportUrls.exportAllUrl !== undefined">
          <v-card-text class="pb-0">
            Zip all media, detections, and edit history from all selected dataset folders
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed
              block
              @click="doExport({ url: exportUrls && exportUrls.exportAllUrl })"
            >
              Everything
            </v-btn>
          </v-card-actions>
          <v-card-text class="pb-0">
            Export All selected Dataset Detections in VIAME CSV and TrackJSON
          </v-card-text>
          <v-checkbox
            v-model="excludeBelowThreshold"
            label="exclude tracks below confidence threshold"
            dense
            hide-details
          />

          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed
              block
              @click="doExport({ url: exportUrls && exportUrls.exportAllUrlDetections })"
            >
              Detections
            </v-btn>
          </v-card-actions>
        </template>
      </v-card>
    </template>
  </v-menu>
</template>

<style scoped>
.downloadMenu {
  max-height: calc(100vh - 30px);
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
