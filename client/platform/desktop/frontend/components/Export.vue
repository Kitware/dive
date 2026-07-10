<script lang="ts">
import {
  defineComponent, reactive, computed, toRef, watch, ref,
} from 'vue';

import {
  usePendingSaveCount, useHandler, useTrackFilters, useSelectedCamera,
} from 'vue-media-annotator/provides';
import AutosavePrompt from 'dive-common/components/AutosavePrompt.vue';
import { MultiType } from 'dive-common/constants';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import { buildPerCameraCalibrationFiles } from 'vue-media-annotator/cameraCalibrationFiles';
import {
  loadMetadata, exportDataset, exportConfiguration, exportCalibrationFile,
  exportCameraCalibration, exportMulticamEverything,
} from 'platform/desktop/frontend/api';
import type { JsonMeta } from 'platform/desktop/constants';

type ExportType = 'dataset' | 'configuration' | 'trackJSON' | 'coco' | 'everything';

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
    const pendingExportType = ref<ExportType>('dataset');

    const pendingSaveCount = usePendingSaveCount();
    const { save } = useHandler();
    const { checkedTypes } = useTrackFilters();
    const selectedCamera = useSelectedCamera();

    const parentId = computed(() => props.id.split('/')[0]);

    watch(toRef(data, 'menuOpen'), async (newval) => {
      if (newval) {
        data.meta = await loadMetadata(parentId.value);
      } else {
        data.err = null;
        data.outPath = '';
      }
    });

    const thresholds = computed(() => (
      data.meta
        ? Object.keys(data.meta.confidenceFilters || {})
        : []));

    const isMulticamDataset = computed(() => data.meta?.type === MultiType);

    const activeCameraName = computed(() => {
      if (selectedCamera.value) {
        return selectedCamera.value;
      }
      const parts = props.id.split('/');
      return parts.length > 1 ? parts[1] : null;
    });

    const calibrationExportName = computed(() => {
      const multiCam = data.meta?.multiCam;
      return multiCam?.calibrationOriginalName
        ?? multiCam?.calibrationSourcePath?.replace(/^.*[\\/]/, '')
        ?? multiCam?.calibration?.replace(/^.*[\\/]/, '')
        ?? null;
    });
    const cameraFileSupported = computed(
      () => data.meta?.subType === 'stereo' && !!calibrationExportName.value,
    );

    // Cameras with an exportable alignment calibration: each pair files under
    // its non-reference camera (reference = first camera in display order),
    // matching how the backend groups pairs into calibration_<camera>.json.
    const calibrationCameras = computed(() => {
      const { meta } = data;
      if (!meta || meta.type !== MultiType || !meta.multiCam) {
        return [];
      }
      return buildPerCameraCalibrationFiles({
        homographies: meta.cameraHomographies ?? {},
        correspondences: meta.cameraCorrespondences ?? {},
        transformTypes: meta.cameraTransformTypes ?? {},
        source: meta.cameraCalibrationSource ?? null,
      }, orderedMultiCamCameraNames(meta.multiCam)[0] ?? null).map((file) => file.camera);
    });

    async function exportCalibration(camera: string) {
      const location = await window.diveDesktop.showSaveDialog({
        title: 'Export Camera Calibration',
        defaultPath: `calibration_${camera}.json`,
      });
      if (location.canceled || !location.filePath) return;
      try {
        data.err = null;
        const { exportedPath } = await exportCameraCalibration(
          parentId.value,
          location.filePath,
          camera,
        );
        data.outPath = exportedPath;
      } catch (err) {
        data.err = err;
        throw err;
      }
    }

    async function exportCameraFile() {
      if (!calibrationExportName.value) return;
      const location = await window.diveDesktop.showSaveDialog({
        title: 'Export Camera File',
        defaultPath: calibrationExportName.value,
      });
      if (location.canceled || !location.filePath) return;
      try {
        data.err = null;
        await exportCalibrationFile(parentId.value, location.filePath);
        data.outPath = location.filePath;
      } catch (err) {
        data.err = err;
        throw err;
      }
    }

    async function doExport({ type, forceSave = false }: { type: ExportType; forceSave?: boolean}) {
      if (pendingSaveCount.value > 0 && forceSave) {
        await save();
        savePrompt.value = false;
      } else if (pendingSaveCount.value > 0) {
        pendingExportType.value = type;
        savePrompt.value = true;
        return;
      }
      try {
        const typeFilter = data.excludeUncheckedTypes ? checkedTypes.value : [];
        if (type === 'dataset') {
          data.err = null;
          data.outPath = await exportDataset(props.id, data.excludeBelowThreshold, typeFilter);
        } else if (type === 'trackJSON') {
          data.err = null;
          data.outPath = await exportDataset(props.id, data.excludeBelowThreshold, typeFilter, 'json');
        } else if (type === 'coco') {
          data.err = null;
          data.outPath = await exportDataset(props.id, data.excludeBelowThreshold, typeFilter, 'coco');
        } else if (type === 'configuration') {
          data.outPath = await exportConfiguration(props.id);
        } else if (type === 'everything') {
          data.err = null;
          data.outPath = await exportMulticamEverything(
            parentId.value,
            data.excludeBelowThreshold,
            typeFilter,
          );
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
      exportCalibration,
      calibrationCameras,
      cameraFileSupported,
      calibrationExportName,
      savePrompt,
      pendingExportType,
      thresholds,
      checkedTypes,
      isMulticamDataset,
      activeCameraName,
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
            @save="doExport({ type: pendingExportType, forceSave: true })"
          />
          <v-alert
            v-if="data.outPath"
            dense
            class="text-caption"
            type="success"
          >
            Export succeeded.
          </v-alert>
          <v-alert
            v-if="isMulticamDataset && activeCameraName"
            type="info"
            outlined
            class="mb-2 active-camera-alert"
          >
            <div class="active-camera-label">
              Annotations export from the active camera
            </div>
            <div class="active-camera-name d-flex align-center">
              <v-icon class="mr-2">
                mdi-camera
              </v-icon>
              {{ activeCameraName }}
            </div>
          </v-alert>
          <div v-else>
            Export to Annotations
          </div>
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
        <template v-if="calibrationCameras.length">
          <v-card-text class="pb-0">
            Export the camera-alignment calibration:
            one calibration_&lt;camera&gt;.json per camera.
          </v-card-text>
          <v-card-actions>
            <v-row>
              <v-col>
                <v-btn
                  v-for="camera in calibrationCameras"
                  :key="camera"
                  depressed
                  block
                  class="my-1"
                  @click="exportCalibration(camera)"
                >
                  Calibration: {{ camera }}
                </v-btn>
              </v-col>
            </v-row>
          </v-card-actions>
        </template>
        <template v-if="isMulticamDataset">
          <v-card-text class="pb-0">
            Zip all cameras: annotations, calibration, and dataset metadata.
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed
              block
              @click="doExport({ type: 'everything' })"
            >
              Everything
            </v-btn>
          </v-card-actions>
        </template>
      </v-card>
    </template>
  </v-menu>
</template>

<style scoped>
.active-camera-alert {
  padding: 10px 12px;
}

.active-camera-label {
  font-size: 0.8125rem;
  line-height: 1.25;
  margin-bottom: 6px;
  opacity: 0.85;
}

.active-camera-name {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.3;
}
</style>
