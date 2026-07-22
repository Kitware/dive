<script lang="ts">
import {
  computed, defineComponent, ref, PropType, onMounted,
} from 'vue';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { clientSettings, isStereoInteractiveModeEnabled } from 'dive-common/store/settings';
import clearLengthAttributes from 'dive-common/utils/clearLengthAttributes';
import warpAnnotationsAcrossCameras from 'dive-common/utils/warpAnnotationsAcrossCameras';
import { cloneDeep } from 'lodash';
import {
  useAnnotationSets, useAnnotationSet, useHandler, useCameraStore, useSelectedCamera,
  useAlignedView, useCameraRegistration,
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
  emits: ['calibration-imported', 'stereo-warp-imported'],
  setup(props, { emit }) {
    const api = useApi();
    const { openFromDisk, importAnnotationFile } = api;
    const lastCalibrationPath = ref('');
    const { reloadAnnotations, save } = useHandler();
    const cameraStore = useCameraStore();
    const selectedCamera = useSelectedCamera();
    const alignedView = useAlignedView();
    const isMulticamDataset = computed(() => cameraStore.camMap.value.size > 1);
    const isStereoDataset = computed(() => props.subType === 'stereo');
    // Stereo warping goes through the interactive stereo service, which
    // needs its features enabled and a camera calibration loaded.
    const stereoWarpAvailable = computed(
      () => isStereoDataset.value && isStereoInteractiveModeEnabled()
        && !!props.calibrationFile,
    );
    // Multicam (non-stereo) warping instead requires the whole rig to be
    // registered (a native->reference transform for every camera).
    const canWarpToAllCameras = computed(() => {
      if (!isMulticamDataset.value) {
        return false;
      }
      if (isStereoDataset.value) {
        return stereoWarpAvailable.value;
      }
      return alignedView.available.value;
    });
    const warpToAllCameras = ref(false);
    const warpToAllCamerasHint = computed(() => {
      if (isStereoDataset.value) {
        if (!isStereoInteractiveModeEnabled()) {
          return 'Requires interactive stereo to be enabled';
        }
        if (!props.calibrationFile) {
          return 'Requires a camera calibration';
        }
        return 'Warps imported detections to the other camera';
      }
      const progress = alignedView.registrationProgress.value;
      return progress
        ? `${progress.registered}/${progress.total} cameras registered`
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
    // Camera registration import (per-camera transform files) is meaningful
    // for multicam datasets; stereo rigs use the calibration (camera file)
    // import instead, so the registration section is hidden there.
    const cameraRegistration = useCameraRegistration();
    const registrationSupported = computed(
      () => !!api.importCameraRegistration && isMulticamDataset.value
        && props.subType !== 'stereo',
    );
    // One import button per non-reference camera pair, labeled in the
    // direction of the mapping -- "Import ir → eo" registers ir onto the
    // reference camera (the import dialog's Reference Camera choice,
    // published by the viewer), matching the
    // <camera>_to_<reference>_registration.json file names -- and colored by
    // whether that camera already has a registration (importing onto an
    // existing one replaces it, after confirmation).
    const registrationImportTargets = computed(() => {
      if (!registrationSupported.value) {
        return [];
      }
      const pairKeys = [
        ...Object.keys(cameraRegistration.homographies.value),
        ...Object.keys(cameraRegistration.correspondences.value),
      ];
      const cams = [...cameraStore.camMap.value.keys()];
      const reference = alignedView.reference.value ?? cams[0];
      return cams.filter((camera) => camera !== reference).map((camera) => ({
        camera,
        label: `Import ${camera} → ${reference}`,
        registered: pairKeys.some((key) => key.split('::').includes(camera)),
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
    // inject() only resolves while a component instance is current, which
    // outside setup() holds solely during render. Resolve the annotation sets
    // here so the computed below can be evaluated from anywhere.
    const annotationSets = useAnnotationSets();
    const sets = computed(() => {
      const temp = cloneDeep(annotationSets.value);
      temp.push('default');
      return temp;
    });
    const defaultSet = useAnnotationSet();
    // Local copy (not an alias of the injected ref); '' means default.
    const currentSet = ref(defaultSet.value || 'default');
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
            ) {
              if (isStereoDataset.value) {
                // The platform (desktop) performs the warp through the
                // interactive stereo service, one detection at a time.
                emit('stereo-warp-imported', activeCameraName.value);
              } else if (alignedView.toReference.value) {
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
    const openRegistrationUpload = async (camera: string) => {
      if (!api.importCameraRegistration) return;
      const target = registrationImportTargets.value.find((entry) => entry.camera === camera);
      if (target?.registered) {
        const confirmed = await prompt({
          title: 'Replace Registration?',
          text: `Camera "${camera}" already has a registration. Importing will replace it.`,
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
        const result = await api.importCameraRegistration(
          props.datasetId,
          ret.filePaths[0],
          ret.fileList?.[0],
          { camera },
        );
        // Rehydrate the store from the freshly persisted meta so the Align
        // View and mirroring pick up the new transforms immediately.
        // Remember whether the Camera Registration panel had a pair active:
        // hydrate() clears it, and the camera list doesn't change on import,
        // so nothing else would re-establish the panel's state.
        const priorPair = cameraRegistration.activePair.value;
        const meta = await api.loadMetadata(parentDatasetId(props.datasetId));
        cameraRegistration.hydrate(
          meta.cameraHomographies,
          meta.cameraCorrespondences,
          meta.cameraTransformTypes,
          meta.cameraRegistrationSource,
        );
        if (priorPair) {
          // The panel is open: re-select the imported pair (falling back to
          // the prior one) so the loaded state is immediately visible, in
          // review posture -- picking stays off for a file-loaded transform.
          const pairKeys = [
            ...Object.keys(cameraRegistration.homographies.value),
            ...Object.keys(cameraRegistration.correspondences.value),
          ];
          // Pair bodies name their own cameras, so a pair can reference one
          // missing from this dataset; only select a pair the panel can show.
          const importedKey = pairKeys.find((key) => key.split('::').includes(camera)
            && key.split('::').every((name) => cameraStore.camMap.value.has(name)));
          const [left, right] = importedKey
            ? importedKey.split('::')
            : [priorPair.camA, priorPair.camB];
          cameraRegistration.setActivePair(left, right);
          cameraRegistration.pickingEnabled.value = cameraRegistration.pickingDefaultFor(
            cameraRegistration.activePairKey(),
          );
        }
        processing.value = false;
        const unknown = result.cameras.filter((name) => !cameraStore.camMap.value.has(name));
        const text = [
          `Imported registration for camera "${camera}".`,
          'Registration can be validated in the Camera Registration menu.',
        ];
        if (unknown.length) {
          text.push(
            `Warning: the file also names camera(s) not in this dataset: ${unknown.join(', ')}.`,
            'Pair bodies name their own cameras, so those pairs will not resolve until matching cameras exist.',
          );
        }
        await prompt({
          title: 'Registration Imported',
          text,
          positiveButton: 'OK',
        });
      } catch (error) {
        processing.value = false;
        prompt({
          title: 'Registration Import Failed',
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
      openRegistrationUpload,
      applyLastCalibration,
      showLastCalibrationSuggestion,
      lastCalibrationFileName,
      cameraFileSupported,
      registrationSupported,
      registrationImportTargets,
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
              class="mt-8"
              dense
            >
              <v-combobox
                v-model="currentSet"
                :items="sets"
                chips
                label="Annotation Set Name"
                outlined
                small
                hide-details
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
            <v-row
              class="flex-nowrap"
              align="center"
            >
              <v-checkbox
                :input-value="!additive"
                label="Overwrite"
                class="mt-2"
                dense
                hide-details
                @change="additive = !$event"
              />
              <v-tooltip
                v-if="isMulticamDataset"
                bottom
                :disabled="!warpToAllCamerasHint"
                open-delay="200"
              >
                <template #activator="{ on }">
                  <div v-on="on">
                    <v-checkbox
                      v-model="warpToAllCameras"
                      :disabled="!canWarpToAllCameras"
                      label="Warp to All"
                      class="mt-2 ml-2"
                      dense
                      hide-details
                    />
                  </div>
                </template>
                <span>{{ warpToAllCamerasHint }}</span>
              </v-tooltip>
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
        <template v-if="registrationSupported">
          <v-divider />
          <v-card-title class="pt-3">
            Import Registration
          </v-card-title>
          <v-card-text class="pb-0">
            Merge a per-camera registration .json into this dataset.
          </v-card-text>
          <v-container>
            <v-col>
              <v-row
                v-for="target in registrationImportTargets"
                :key="target.camera"
              >
                <v-btn
                  depressed
                  block
                  class="mb-2"
                  :color="target.registered ? 'success' : 'warning'"
                  :disabled="!datasetId || processing"
                  @click="openRegistrationUpload(target.camera)"
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
