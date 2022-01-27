<script lang="ts">
import {
  computed, defineComponent, ref, shallowRef, toRef, watch, PropType,
} from '@vue/composition-api';
import { usePendingSaveCount, useHandler, useCheckedTypes } from 'vue-media-annotator/provides';
import AutosavePrompt from 'dive-common/components/AutosavePrompt.vue';
import { useRequest } from 'dive-common/use';
import {
  DatasetSourceMedia, getDataset, getDatasetMedia, getUri,
} from 'platform/web-girder/api';
import { GirderMetadataStatic } from 'platform/web-girder/constants';
import {
  ImageSequenceType, MultiType, VideoType,
} from 'dive-common/constants';

export default defineComponent({
  components: { AutosavePrompt },

  props: {
    datasetIds: {
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
    if (props.blockOnUnsaved) {
      save = useHandler().save;
      pendingSaveCount = usePendingSaveCount();
      checkedTypes = useCheckedTypes();
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

    const menuOpen = ref(false);
    const excludeBelowThreshold = ref(true);
    const excludeUncheckedTypes = ref(false);

    const singleDataSetId = computed(() => {
      if (props.datasetIds.length === 1) {
        return props.datasetIds[0];
      }
      return null;
    });
    const dataset = shallowRef(null as GirderMetadataStatic | null);
    const datasetMedia = shallowRef(null as DatasetSourceMedia | null);
    const { request, error } = useRequest();
    const loadDatasetMeta = () => request(async () => {
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
      if (singleDataSetId.value) {
        return {
          exportAllUrl: getUri({
            url: `dive_dataset/${singleDataSetId.value}/export`,
            params,
          }),
          exportMediaUrl: dataset.value?.type === 'video'
            ? datasetMedia.value?.video?.url
            : getUri({
              url: `dive_dataset/${singleDataSetId.value}/export`,
              params: { ...params, includeDetections: false, includeMedia: true },
            }),
          exportDetectionsUrl: getUri({
            url: 'dive_annotation/export',
            params: { ...params, folderId: singleDataSetId.value },
          }),
          exportConfigurationUrl: getUri({
            url: `dive_dataset/${singleDataSetId.value}/configuration`,
          }),
        };
      }
      return {
        exportAllUrl: getUri({
          url: 'dive_dataset/batch_export',
          params: { ...params, batchIds: props.datasetIds },
        }),
        exportMediaUrl: dataset.value?.type === 'video'
          ? datasetMedia.value?.video?.url
          : getUri({
            url: 'dive_dataset/batch_export',
            params: {
              ...params, includeDetections: false, includeMedia: true, batchIds: props.datasetIds,
            },
          }),
        exportDetectionsUrl: getUri({
          url: 'dive_annotation/batch_export',
          params: { ...params, folderId: singleDataSetId.value, batchIds: props.datasetIds },
        }),
        exportConfigurationUrl: getUri({
          url: 'dive_annotation/batch_export',
          params: {
            ...params,
            folderId: singleDataSetId.value,
            batchIds: props.datasetIds,
            configurationsOnly: true,
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
      }[type];
    });

    return {
      error,
      dataset,
      mediaType,
      excludeBelowThreshold,
      excludeUncheckedTypes,
      menuOpen,
      exportUrls,
      checkedTypes,
      savePrompt,
      doExport,
    };
  },
});
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
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
            :disabled="!singleDataSetId"
            v-on="{ ...tooltipOn, ...menuOn }"
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
            <v-icon v-if="menuOptions.right">
              mdi-chevron-right
            </v-icon>
          </v-btn>
        </template>
        <span>Download media and annotations</span>
      </v-tooltip>
    </template>
    <template>
      <AutosavePrompt
        v-model="savePrompt"
        @save="doExport({ forceSave: true })"
      />
      <v-card
        outlined
      >
        <v-card-title>
          Download options
        </v-card-title>
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
            <div>Get latest detections csv only</div>
            <template v-if="dataset.confidenceFilters">
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
            <v-btn
              depressed
              block
              :disabled="!exportUrls.exportDetectionsUrl"
              @click="doExport({ url: exportUrls && exportUrls.exportDetectionsUrl })"
            >
              <span v-if="exportUrls.exportDetectionsUrl">detections</span>
              <span v-else>detections unavailable</span>
            </v-btn>
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
      </v-card>
    </template>
  </v-menu>
</template>
