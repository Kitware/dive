<script lang="ts">
import {
  computed, defineComponent, ref, PropType,
} from 'vue';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { clientSettings } from 'dive-common/store/settings';
import clearLengthAttributes from 'dive-common/utils/clearLengthAttributes';
import { cloneDeep } from 'lodash';
import {
  useAnnotationSets, useAnnotationSet, useHandler, useCameraStore,
} from 'vue-media-annotator/provides';
import { getResponseError } from 'vue-media-annotator/utils';

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
    const { reloadAnnotations, save } = useHandler();
    const cameraStore = useCameraStore();
    // Camera/calibration file import is desktop-only (needs importCalibrationFile)
    // and only meaningful for stereo datasets.
    const cameraFileSupported = computed(
      () => !!api.importCalibrationFile && props.subType === 'stereo',
    );
    const currentCalibrationName = computed(() => {
      if (!props.calibrationFile) return '';
      return props.calibrationFile.replace(/^.*[\\/]/, '');
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
            processing.value = false;
            await reloadAnnotations();
          }
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
    return {
      openUpload,
      openCalibrationUpload,
      cameraFileSupported,
      currentCalibrationName,
      processing,
      menuOpen,
      additive,
      additivePrepend,
      clientSettings,
      sets,
      currentSet,
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
        <span> Import Annotation Data </span>
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
        <template v-if="cameraFileSupported">
          <v-divider />
          <v-card-title class="pt-3">
            Import Camera File
          </v-card-title>
          <v-card-text class="pb-0">
            <div v-if="currentCalibrationName">
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
                  depressed
                  block
                  :disabled="!datasetId || processing"
                  @click="openCalibrationUpload"
                >
                  Import
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
