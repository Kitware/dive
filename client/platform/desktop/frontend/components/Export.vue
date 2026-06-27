<script lang="ts">
import {
  defineComponent, reactive, computed, toRef, watch, ref,
} from 'vue';

import { usePendingSaveCount, useHandler, useTrackFilters } from 'vue-media-annotator/provides';
import AutosavePrompt from 'dive-common/components/AutosavePrompt.vue';
import {
  loadMetadata, exportDataset, exportConfiguration, exportCalibrationFile,
} from 'platform/desktop/frontend/api';
import type { JsonMeta } from 'platform/desktop/constants';

export default defineComponent({
  name: 'Export',

  components: { AutosavePrompt },

  props: {
    id: {
      type: String,
      required: true,
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
    const data = reactive({
      menuOpen: false,
      excludeBelowThreshold: true,
      excludeUncheckedTypes: false,
      activator: 0,
      err: null as unknown,
      meta: null as JsonMeta | null,
      outPath: '',
    });
    const savePrompt = ref(false);

    const pendingSaveCount = usePendingSaveCount();
    const { save } = useHandler();
    const { checkedTypes } = useTrackFilters();

    watch(toRef(data, 'menuOpen'), async (newval) => {
      if (newval) {
        data.meta = await loadMetadata(props.id);
      } else {
        data.err = null;
        data.outPath = '';
      }
    });

    const thresholds = computed(() => (
      data.meta
        ? Object.keys(data.meta.confidenceFilters || {})
        : []));

    const calibrationFile = computed(() => data.meta?.multiCam?.calibration ?? null);
    const cameraFileSupported = computed(
      () => data.meta?.subType === 'stereo' && !!calibrationFile.value,
    );

    async function exportCameraFile() {
      if (!calibrationFile.value) return;
      const calName = calibrationFile.value.replace(/^.*[\\/]/, '');
      const location = await window.diveDesktop.showSaveDialog({
        title: 'Export Camera File',
        defaultPath: calName,
      });
      if (location.canceled || !location.filePath) return;
      try {
        data.err = null;
        await exportCalibrationFile(props.id, location.filePath);
        data.outPath = location.filePath;
      } catch (err) {
        data.err = err;
        throw err;
      }
    }

    async function doExport({ type, forceSave = false }: { type: 'dataset' | 'configuration' | 'trackJSON' | 'coco'; forceSave?: boolean}) {
      if (pendingSaveCount.value > 0 && forceSave) {
        await save();
        savePrompt.value = false;
      } else if (pendingSaveCount.value > 0) {
        savePrompt.value = true;
        return;
      }
      try {
        if (type === 'dataset') {
          const typeFilter = data.excludeUncheckedTypes ? checkedTypes.value : [];
          data.err = null;
          data.outPath = await exportDataset(props.id, data.excludeBelowThreshold, typeFilter);
        } else if (type === 'trackJSON') {
          const typeFilter = data.excludeUncheckedTypes ? checkedTypes.value : [];
          data.err = null;
          data.outPath = await exportDataset(props.id, data.excludeBelowThreshold, typeFilter, 'json');
        } else if (type === 'coco') {
          const typeFilter = data.excludeUncheckedTypes ? checkedTypes.value : [];
          data.err = null;
          data.outPath = await exportDataset(props.id, data.excludeBelowThreshold, typeFilter, 'coco');
        } else if (type === 'configuration') {
          data.outPath = await exportConfiguration(props.id);
        }
      } catch (err) {
        data.err = err;
        throw err;
      }
    }

    return {
      data,
      doExport,
      exportCameraFile,
      cameraFileSupported,
      calibrationFile,
      savePrompt,
      thresholds,
      checkedTypes,
    };
  },
});
</script>

<template>
  <v-menu
    v-model="data.menuOpen"
    :close-on-content-click="false"
    :nudge-width="280"
    v-bind="menuOptions"
    max-width="280"
  >
    <template #activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            class="ma-0"
            v-bind="buttonOptions"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <div>
              <v-icon>
                mdi-export
              </v-icon>
              <span
                v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
                class="pl-1"
              >
                Export
              </span>
            </div>
          </v-btn>
        </template>
        <span> Export Annotation Data </span>
      </v-tooltip>
    </template>
    <template>
      <v-card v-if="data.menuOpen">
        <v-card-title>
          Export options
        </v-card-title>

        <v-card-text class="pb-2">
          <v-dialog
            max-width="600"
            persistent
            :value="data.err"
            :overlay-opacity="0.95"
          >
            <v-card outlined>
              <v-card-text class="pa-3">
                <v-card-text class="text-h4">
                  Error
                </v-card-text>
                <v-alert
                  type="error"
                >
                  {{ data.err }}
                </v-alert>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn
                  color="primary"
                  @click="data.err = null"
                >
                  <v-icon>mdi-close</v-icon>
                  Dismiss
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>
          <AutosavePrompt
            v-model="savePrompt"
            @save="doExport({ type: 'dataset', forceSave: true })"
          />
          <v-alert
            v-if="data.outPath"
            dense
            class="text-caption"
            type="success"
          >
            Export succeeded.
          </v-alert>
          <div>Export to Annotations</div>
          <template v-if="thresholds.length">
            <v-checkbox
              v-model="data.excludeBelowThreshold"
              label="exclude tracks below confidence threshold"
              dense
              hide-details
            />
            <div
              v-if="data.meta && data.meta.confidenceFilters"
              class="pt-2"
            >
              <div>Current thresholds:</div>
              <span
                v-for="(val, key) in data.meta.confidenceFilters"
                :key="key"
                class="pt-2"
              >
                ({{ key }}, {{ val }})
              </span>
            </div>
          </template>

          <template v-if="checkedTypes.length">
            <v-checkbox
              v-model="data.excludeUncheckedTypes"
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
                class="my-1"
                @click="doExport({ type: 'dataset' })"
              >
                <span>VIAME CSV</span>
              </v-btn>
              <v-btn
                depressed
                block
                class="my-1"
                @click="doExport({ type: 'trackJSON' })"
              >
                <span>TRACK JSON</span>
              </v-btn>
              <v-btn
                depressed
                block
                class="my-1"
                @click="doExport({ type: 'coco' })"
              >
                <span>COCO JSON</span>
              </v-btn>
            </v-col>
          </v-row>
        </v-card-actions>
        <v-card-text class="pb-0">
          Export the dataset configuration, including
          attribute definitions, types, styles, thresholds, and dataset info.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            block
            @click="doExport({ type: 'configuration' })"
          >
            Configuration
          </v-btn>
        </v-card-actions>
        <template v-if="cameraFileSupported">
          <v-card-text class="pb-0">
            Export the stereo camera / calibration file currently associated
            with this dataset.
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed
              block
              @click="exportCameraFile"
            >
              Camera File
            </v-btn>
          </v-card-actions>
        </template>
      </v-card>
    </template>
  </v-menu>
</template>
