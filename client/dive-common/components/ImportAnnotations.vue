<script lang="ts">
import {
  computed, defineComponent, ref, PropType, onMounted,
} from 'vue';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { clientSettings } from 'dive-common/store/settings';
import clearLengthAttributes from 'dive-common/utils/clearLengthAttributes';
import warpAnnotationsAcrossCameras from 'dive-common/utils/warpAnnotationsAcrossCameras';
import { cloneDeep } from 'lodash';
import {
  useAnnotationSets, useAnnotationSet, useHandler, useCameraStore, useSelectedCamera,
  useAlignedView, useCameraCalibration,
} from 'vue-media-annotator/provides';
import { getResponseError } from 'vue-media-annotator/utils';
import { parentDatasetId } from 'dive-common/compositeDatasetId';

export default defineComponent({
  name: 'ImportAnnotations',
  props: {
    datasetId: {
      type: String,
      default: null,
    },
    subType: {
      type: String as PropType<string | null>,
      default: null,
    },
    calibrationFile: {
      type: String as PropType<string | null>,
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
    readOnlyMode: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['calibration-imported'],
  setup(props, { emit }) {
    const api = useApi();
    const { openFromDisk, importAnnotationFile } = api;
    const lastCalibrationPath = ref('');
    const { reloadAnnotations, save } = useHandler();
    const cameraStore = useCameraStore();
    const selectedCamera = useSelectedCamera();
    const alignedView = useAlignedView();
    const isMulticamDataset = computed(() => cameraStore.camMap.value.size > 1);
    // Warping detections onto other cameras requires the whole rig to be
    // calibrated (a native->reference transform for every camera).
    const canWarpToAllCameras = computed(
      () => isMulticamDataset.value && alignedView.available.value,
    );
    const warpToAllCameras = ref(false);
    const warpToAllCamerasHint = computed(() => {
      const progress = alignedView.calibrationProgress.value;
      return progress
        ? `${progress.calibrated}/${progress.total} cameras calibrated`
        : '';
    });
    const activeCameraName = computed(() => {
      if (!isMulticamDataset.value) {
        return null;
      }
      if (selectedCamera.value) {
        return selectedCamera.value;
      }
      const parts = (props.datasetId || '').split('/');
      return parts.length > 1 ? parts[1] : null;
    });
    // Camera/calibration file import requires importCalibrationFile (web + desktop)
    // and is only meaningful for stereo datasets.
    const cameraFileSupported = computed(
      () => !!api.importCalibrationFile && props.subType === 'stereo',
    );
    // Camera-alignment calibration import (per-camera transform files) is
    // meaningful for any multicam dataset.
    const cameraCalibration = useCameraCalibration();
    const alignmentCalibrationSupported = computed(
      () => !!api.importCameraCalibration && isMulticamDataset.value,
    );
    // One import button per non-reference camera pair (reference = first
    // camera in display order), labeled like "Import eo → ir" and colored by
    // whether that camera already has a calibration (importing onto an
    // existing one replaces it, after confirmation).
    const calibrationImportTargets = computed(() => {
      if (!alignmentCalibrationSupported.value) {
        return [];
      }
      const pairKeys = [
        ...Object.keys(cameraCalibration.homographies.value),
        ...Object.keys(cameraCalibration.correspondences.value),
      ];
      const cams = [...cameraStore.camMap.value.keys()];
      const reference = cams[0];
      return cams.slice(1).map((camera) => ({
        camera,
        label: `Import ${reference} → ${camera}`,
        calibrated: pairKeys.some((key) => key.split('::').includes(camera)),
      }));
    });
    const currentCalibrationName = computed(() => {
      if (!props.calibrationFile) return '';
      return props.calibrationFile.replace(/^.*[\\/]/, '');
    });
    const showLastCalibrationSuggestion = computed(
      () => cameraFileSupported.value
        && !props.calibrationFile
        && !!lastCalibrationPath.value,
    );
    const lastCalibrationFileName = computed(
      () => lastCalibrationPath.value.replace(/^.*[\\/]/, ''),
    );
    onMounted(async () => {
      if (api.getLastCalibration) {
        const lastCalibration = await api.getLastCalibration();
        if (lastCalibration) {
          lastCalibrationPath.value = lastCalibration;
        }
      }
    });
    const sets = computed(() => {
      const data = useAnnotationSets();
      const temp = cloneDeep(data.value);
      temp.push('default');
      return temp;
    });
    const defaultSet = useAnnotationSet();
    const currentSet = ref(defaultSet || 'default');
    const { prompt } = usePrompt();
    const processing = ref(false);
    const menuOpen = ref(false);
    const additive = ref(false);
    const additivePrepend = ref('');
    const openUpload = async () => {
      try {
        const ret = await openFromDisk('annotation');
        if (!ret.canceled) {
          menuOpen.value = false;
          const path = ret.filePaths[0];
          let importFile: boolean | string[] = false;
          processing.value = true;
          const set = currentSet.value === 'default' ? undefined : currentSet.value;
          if (ret.fileList?.length) {
            importFile = await importAnnotationFile(
              props.datasetId,
              path,
              ret.fileList[0],
              additive.value,
              additivePrepend.value,
              set,
            );
          } else {
            importFile = await importAnnotationFile(
              props.datasetId,
              path,
              undefined,
              additive.value,
              additivePrepend.value,
              set,
            );
          }
          if (Array.isArray(importFile) && importFile.length) {
            const text = ['There were warnings when importing. While the data imported properly please double check your annotations',
              'Below is a list of information that can help with debugging',
            ].concat(importFile as string[]);
            await prompt({
              title: 'Import Warnings',
              text,
              positiveButton: 'OK',
            });
          }

          if (importFile) {
            await reloadAnnotations();
            if (
              warpToAllCameras.value
              && canWarpToAllCameras.value
              && activeCameraName.value
              && alignedView.toReference.value
            ) {
              const warped = warpAnnotationsAcrossCameras(
                cameraStore,
                alignedView.toReference.value,
                activeCameraName.value,
              );
              if (warped.tracks > 0) {
                await save();
              }
            }
          }
          processing.value = false;
        }
      } catch (error) {
        const text = [getResponseError(error)];
        prompt({
          title: 'Import Failed',
          text,
          positiveButton: 'OK',
        });
        processing.value = false;
      }
    };
    const openCalibrationUpload = async () => {
      if (!api.importCalibrationFile) return;
      try {
        const ret = await openFromDisk('calibration');
        if (ret.canceled || !ret.filePaths.length) return;
        menuOpen.value = false;
        processing.value = true;
        const result = await api.importCalibrationFile(props.datasetId, ret.filePaths[0]);
        // A new camera file invalidates length measurements from the prior
        // calibration; clear them (and their length_method locks) when checked.
        if (clientSettings.stereoSettings.clearLengthOnCameraFileLoad) {
          const cleared = clearLengthAttributes(cameraStore);
          if (cleared > 0) {
            await save();
          }
        }
        processing.value = false;
        emit('calibration-imported', result.calibration);
      } catch (error) {
        processing.value = false;
        prompt({
          title: 'Camera File Import Failed',
          text: [getResponseError(error)],
          positiveButton: 'OK',
        });
      }
    };
    const openAlignmentCalibrationUpload = async (camera: string) => {
      if (!api.importCameraCalibration) return;
      const target = calibrationImportTargets.value.find((entry) => entry.camera === camera);
      if (target?.calibrated) {
        const confirmed = await prompt({
          title: 'Replace Calibration?',
          text: `Camera "${camera}" already has a calibration. Importing will replace it.`,
          positiveButton: 'Replace',
          negativeButton: 'Cancel',
          confirm: true,
        });
        if (!confirmed) return;
      }
      try {
        const ret = await openFromDisk('transform');
        if (ret.canceled || !ret.filePaths.length) return;
        menuOpen.value = false;
        processing.value = true;
        const result = await api.importCameraCalibration(
          props.datasetId,
          ret.filePaths[0],
          ret.fileList?.[0],
          { camera },
        );
        // Rehydrate the store from the freshly persisted meta so the Align
        // View and mirroring pick up the new transforms immediately.
        const meta = await api.loadMetadata(parentDatasetId(props.datasetId));
        cameraCalibration.hydrate(
          meta.cameraHomographies,
          meta.cameraCorrespondences,
          meta.cameraTransformTypes,
          meta.cameraCalibrationSource,
        );
        processing.value = false;
        const unknown = result.cameras.filter((name) => !cameraStore.camMap.value.has(name));
        if (unknown.length) {
          await prompt({
            title: 'Calibration Imported',
            text: [
              `Imported ${result.pairCount} pair(s), but the file names camera(s) not in this dataset:`,
              unknown.join(', '),
              'Pair bodies name their own cameras, so these pairs will not resolve until matching cameras exist.',
            ],
            positiveButton: 'OK',
          });
        }
      } catch (error) {
        processing.value = false;
        prompt({
          title: 'Calibration Import Failed',
          text: [getResponseError(error)],
          positiveButton: 'OK',
        });
      }
    };
    const applyLastCalibration = async () => {
      if (!api.importCalibrationFile || !lastCalibrationPath.value) return;
      try {
        menuOpen.value = false;
        processing.value = true;
        const result = await api.importCalibrationFile(
          props.datasetId,
          lastCalibrationPath.value,
        );
        if (clientSettings.stereoSettings.clearLengthOnCameraFileLoad) {
          const cleared = clearLengthAttributes(cameraStore);
          if (cleared > 0) {
            await save();
          }
        }
        processing.value = false;
        emit('calibration-imported', result.calibration);
      } catch (error) {
        processing.value = false;
        prompt({
          title: 'Camera File Import Failed',
          text: [getResponseError(error)],
          positiveButton: 'OK',
        });
      }
    };
    return {
      openUpload,
      openCalibrationUpload,
      openAlignmentCalibrationUpload,
      applyLastCalibration,
      showLastCalibrationSuggestion,
      lastCalibrationFileName,
      cameraFileSupported,
      alignmentCalibrationSupported,
      calibrationImportTargets,
      currentCalibrationName,
      processing,
      menuOpen,
      additive,
      additivePrepend,
      clientSettings,
      sets,
      currentSet,
      isMulticamDataset,
      activeCameraName,
      canWarpToAllCameras,
      warpToAllCameras,
      warpToAllCamerasHint,
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
            :disabled="!datasetId || processing"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <div>
              <v-icon>
                {{ processing ? 'mdi-spin mdi-sync' : 'mdi-application-import' }}
              </v-icon>
              <span
                v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
                class="pl-1"
              >
                Import
              </span>
            </div>
          </v-btn>
        </template>
        <span> Import Supplementary Data </span>
      </v-tooltip>
    </template>
    <template>
      <v-card v-if="readOnlyMode">
        <v-card-title> Read only Mode</v-card-title>
        <v-card-text>
          This Dataset is in ReadOnly Mode.  You cannot import annotations for this dataset.
        </v-card-text>
      </v-card>
      <v-card
        v-else
        outlined
      >
        <v-card-title>
          Import Annotations
        </v-card-title>
        <v-card-text
          v-if="isMulticamDataset && activeCameraName"
          class="pb-0"
        >
          <v-alert
            type="info"
            outlined
            class="mb-0 active-camera-alert"
          >
            <div class="active-camera-label">
              Annotations import to the active camera
            </div>
            <div class="active-camera-name d-flex align-center">
              <v-icon class="mr-2">
                mdi-camera
              </v-icon>
              {{ activeCameraName }}
            </div>
          </v-alert>
        </v-card-text>
        <v-card-text>
          Multiple Data types can be imported:
          <ul>
            <li> VIAME CSV Files </li>
            <li> DIVE Annotation JSON </li>
            <li> DIVE Configuration JSON</li>
            <li> COCO / KWCOCO JSON files </li>
          </ul>
          <a
            href="https://kitware.github.io/dive/DataFormats/"
            target="_blank"
          >Data Format Documentation</a>
        </v-card-text>
        <v-container>
          <v-col>
            <v-row>
              <v-btn
                depressed
                block
                :disabled="!datasetId || processing"
                @click="openUpload"
              >
                Import
              </v-btn>
            </v-row>
            <v-row
              v-if="currentSet !== ''"
              class="mt-3"
              dense
            >
              <v-combobox
                v-model="currentSet"
                :items="sets"
                chips
                label="Annotation Set"
                outlined
                small
              >
                <template #selection="{ attrs, item, selected }">
                  <v-chip
                    v-bind="attrs"
                    small
                    :input-value="selected"
                    outlined
                  >
                    <strong>{{ item }}</strong>&nbsp;
                  </v-chip>
                </template>
              </v-combobox>
            </v-row>
            <v-row>
              <v-checkbox
                :input-value="!additive"
                label="Overwrite"
                @change="additive = !$event"
              />
              <v-checkbox
                v-if="isMulticamDataset"
                v-model="warpToAllCameras"
                :disabled="!canWarpToAllCameras"
                label="Warp to All"
                :hint="warpToAllCamerasHint"
                persistent-hint
                class="ml-4"
              />
            </v-row>
            <div v-if="additive">
              <div
                v-if="additive"
                class="pa-2"
              >
                Imported annotations will be added to existing annotations.
              </div>
              <div class="pa-2">
                The types can be modified to have a prepended value for comparison.
              </div>
              <v-text-field
                v-model="additivePrepend"
                label="Prepend to types"
                clearable
              />
            </div>
          </v-col>
        </v-container>
        <template v-if="alignmentCalibrationSupported">
          <v-divider />
          <v-card-title class="pt-3">
            Import Calibration
          </v-card-title>
          <v-card-text class="pb-0">
            Merge a per-camera calibration .json into this dataset.
          </v-card-text>
          <v-container>
            <v-col>
              <v-row
                v-for="target in calibrationImportTargets"
                :key="target.camera"
              >
                <v-btn
                  depressed
                  block
                  class="mb-2"
                  :color="target.calibrated ? 'success' : 'warning'"
                  :disabled="!datasetId || processing"
                  @click="openAlignmentCalibrationUpload(target.camera)"
                >
                  {{ target.label }}
                </v-btn>
              </v-row>
            </v-col>
          </v-container>
        </template>
        <template v-if="cameraFileSupported">
          <v-divider />
          <v-card-title class="pt-3">
            Import Camera File
          </v-card-title>
          <v-card-text class="pb-0">
            <v-alert
              v-if="showLastCalibrationSuggestion"
              type="info"
              outlined
              dense
              class="mb-3"
            >
              No camera file loaded. Use your last calibration file
              <strong v-if="lastCalibrationFileName">({{ lastCalibrationFileName }})</strong>
              or choose a different one.
            </v-alert>
            <div v-else-if="currentCalibrationName">
              A camera file is loaded.
            </div>
            <div
              v-else
              class="grey--text"
            >
              No camera file loaded.
            </div>
            <div class="caption pt-1">
              Import any VIAME-supported stereo calibration; it is stored with the dataset.
            </div>
          </v-card-text>
          <v-container>
            <v-col>
              <v-row>
                <v-btn
                  v-if="showLastCalibrationSuggestion"
                  depressed
                  block
                  color="primary"
                  class="mb-2"
                  :disabled="!datasetId || processing"
                  @click="applyLastCalibration"
                >
                  Use last calibration
                </v-btn>
                <v-btn
                  depressed
                  block
                  :disabled="!datasetId || processing"
                  @click="openCalibrationUpload"
                >
                  {{ showLastCalibrationSuggestion ? 'Choose calibration' : 'Import' }}
                </v-btn>
              </v-row>
              <v-row>
                <v-checkbox
                  v-model="clientSettings.stereoSettings.clearLengthOnCameraFileLoad"
                  label="Reset length measurements"
                />
              </v-row>
            </v-col>
          </v-container>
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
