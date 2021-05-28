<script lang="ts">
import {
  computed, defineComponent, watch, ref, toRef,
} from '@vue/composition-api';

import { usePendingSaveCount, useHandler } from 'vue-media-annotator/provides';
import AutosavePrompt from 'dive-common/components/AutosavePrompt.vue';
import { MediaTypes } from 'dive-common/constants';
import { withRestError } from 'platform/web-girder/utils';
import { getExportUrls, ExportUrlsResponse } from '../api/viameDetection.service';

export default defineComponent({
  components: { AutosavePrompt },

  props: {
    datasetId: {
      type: String,
      default: null,
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
    const menuOpen = ref(false);
    const excludeFiltered = ref(false);
    const exportUrls = ref(null as null | ExportUrlsResponse);
    const savePrompt = ref(false);
    const currentSaveUrl = ref('');
    let save = () => Promise.resolve();
    let pendingSaveCount = ref(0);

    if (props.blockOnUnsaved) {
      save = useHandler().save;
      pendingSaveCount = usePendingSaveCount();
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
        currentSaveUrl.value = url;
        return;
      }
      if (url) {
        window.location.assign(url);
      } else if (forceSave && currentSaveUrl.value) {
        window.location.assign(currentSaveUrl.value);
      } else {
        throw new Error('Expected either url OR forceSave and currentSaveUrl');
      }
    }

    const { func: updateExportUrls, error } = withRestError(async () => {
      if (menuOpen.value) {
        exportUrls.value = await getExportUrls(props.datasetId, excludeFiltered.value);
      }
    });
    watch([toRef(props, 'datasetId'), excludeFiltered, menuOpen], updateExportUrls);
    updateExportUrls();

    const mediaType = computed(() => (exportUrls.value
      ? MediaTypes[exportUrls.value.mediaType]
      : null));
    const thresholds = computed(() => Object.keys(exportUrls.value?.currentThresholds || {}));

    return {
      error,
      excludeFiltered,
      menuOpen,
      exportUrls,
      mediaType,
      thresholds,
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
            :disabled="!datasetId"
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

        <template v-if="exportUrls">
          <v-card-text class="pb-0">
            Zip all {{ mediaType || 'media' }} files only
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
            <v-btn
              depressed
              block
              :disabled="!exportUrls.exportDetectionsUrl"
              @click="doExport({ url: exportUrls && exportUrls.exportDetectionsUrl })"
            >
              <span v-if="exportUrls.exportDetectionsUrl">detections</span>
              <span v-else>detections unavailable</span>
            </v-btn>
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
