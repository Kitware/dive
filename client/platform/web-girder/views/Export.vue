<script lang="ts">
import {
  computed, defineComponent, watch, ref, toRef,
} from '@vue/composition-api';

import { usePendingSaveCount, useHandler } from 'vue-media-annotator/provides';
import AutosavePrompt from 'dive-common/components/AutosavePrompt.vue';
import { MediaTypes } from 'dive-common/constants';
import { getExportUrls, ExportUrlsResponse } from '../api/viameDetection.service';


export default defineComponent({
  components: { AutosavePrompt },

  props: {
    datasetId: {
      type: String,
      required: true,
    },
    small: {
      type: Boolean,
      default: false,
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

    try {
      save = useHandler().save;
      pendingSaveCount = usePendingSaveCount();
    } catch (err) {
      /**
       * Error indicates that this export dialog was opened in a place
       * outside the viewer where pending changes aren't possible.
       */
    }

    async function doExport({ forceSave = false, url }: { url?: string; forceSave?: boolean }) {
      if (pendingSaveCount.value > 0 && forceSave) {
        await save();
        savePrompt.value = false;
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

    /** TODO replace with watchEffect */
    async function updateExportUrls() {
      if (menuOpen.value) {
        exportUrls.value = await getExportUrls(props.datasetId, excludeFiltered.value);
      }
    }
    watch([toRef(props, 'datasetId'), excludeFiltered, menuOpen], updateExportUrls);
    updateExportUrls();

    const mediaType = computed(() => (exportUrls.value
      ? MediaTypes[exportUrls.value.mediaType]
      : null));
    const thresholds = computed(() => Object.keys(exportUrls.value?.currentThresholds || {}));

    return {
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
    offset-y
    max-width="280"
  >
    <template #activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            class="ma-0"
            text
            :small="small"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <v-icon color="accent">
              mdi-download
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown"
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
      <v-card v-if="menuOpen && exportUrls">
        <v-card-title>
          Download options
        </v-card-title>

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
          <v-spacer />
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
      </v-card>
    </template>
  </v-menu>
</template>
