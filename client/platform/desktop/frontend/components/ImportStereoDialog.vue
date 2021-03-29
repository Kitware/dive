<script lang="ts">
import {
  computed, defineComponent, ref, Ref,
} from '@vue/composition-api';
import npath from 'path';
import { filterByGlob } from 'platform/desktop/sharedUtils';
import { MediaImportPayload } from 'platform/desktop/constants';
import { DatasetType } from 'dive-common/apispec';
import * as api from '../api';


export default defineComponent({
  name: 'ImportStereoDialog',
  setup(props, { emit }) {
    const importType: Ref<'multi'|'keyword'| ''> = ref('');
    const leftFolder = ref('');
    const rightFolder = ref('');
    const keywordFolder = ref('');
    const pendingImportPayload: Ref<MediaImportPayload | null> = ref(null);
    const globPatternLeft = ref('');
    const globPatternRight = ref('');
    const calibrationFile = ref('');
    const defaultDisplay = ref('left');

    const filteredImagesLeft = computed(() => {
      if (pendingImportPayload.value) {
        return filterByGlob(
          globPatternLeft.value,
          pendingImportPayload.value.jsonMeta.originalImageFiles,
        );
      }
      return [];
    });
    const filteredImagesRight = computed(() => {
      if (pendingImportPayload.value) {
        return filterByGlob(
          globPatternRight.value,
          pendingImportPayload.value.jsonMeta.originalImageFiles,
        );
      }
      return [];
    });

    const keywordReady = computed(() => {
      if (!filteredImagesRight.value.length || !filteredImagesLeft.value.length) {
        return 'Requires filtered Left and Right Images';
      }
      if (filteredImagesRight.value.length !== filteredImagesLeft.value.length) {
        return 'Left and Right filters should have the same number of images';
      }
      if (
        filteredImagesRight.value.filter(
          (value: string) => filteredImagesLeft.value.includes(value),
        ).length
      ) {
        return 'Intersecting values.  Images must be unique to Left and Right';
      }
      return 'Success';
    });

    const nextSteps = computed(() => {
      if (importType.value === 'multi' && leftFolder.value && rightFolder.value) {
        return true;
      }
      if (importType.value === 'keyword' && keywordFolder.value && keywordReady.value === 'Success') {
        return true;
      }
      return false;
    });

    async function open(dstype: DatasetType, folder: 'left' | 'right' | 'keyword') {
      const ret = await api.openFromDisk(dstype);
      if (!ret.canceled) {
        try {
          const path = ret.filePaths[0];
          const dsName = npath.parse(path).name;
          if (folder === 'left') {
            leftFolder.value = path;
          }
          if (folder === 'right') {
            rightFolder.value = path;
          }
          if (folder === 'keyword') {
            keywordFolder.value = path;
            pendingImportPayload.value = await api.importMedia(path);
          }
        } catch (err) {
          console.log(err);
        }
      }
    }

    const prepForImport = () => {
      if (importType.value === 'multi') {
        emit('begin-stereo-import', {
          defaultDisplay: defaultDisplay.value,
          leftFolder: leftFolder.value,
          rightFolder: rightFolder.value,
          calibrationFile: calibrationFile.value,
        });
      } else if (importType.value === 'keyword') {
        emit('begin-stereo-import', {
          defaultDisplay: defaultDisplay.value,
          keywordFolder: keywordFolder.value,
          globPatternLeft: globPatternLeft.value,
          globPatternRight: globPatternRight.value,
          calibrationFile: calibrationFile.value,
        });
      }
    };
    return {
      keywordReady,
      nextSteps,
      importType,
      leftFolder,
      rightFolder,
      keywordFolder,
      pendingImportPayload,
      globPatternLeft,
      globPatternRight,
      filteredImagesLeft,
      filteredImagesRight,
      calibrationFile,
      defaultDisplay,
      //Methods
      open,
      prepForImport,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="import-card"
    style="overflow-x: hidden;"
  >
    <v-card-title class="text-h5">
      Import Stero Dataset
    </v-card-title>
    <v-card-text>
      Please Select an import type.
      <v-radio-group v-model="importType">
        <v-radio
          value="multi"
          label="Multi-Folder: Import a left and right folder"
        />
        <v-radio
          value="keyword"
          label="Keyword Filter: Use a filter to deteremine left and right images"
        />
      </v-radio-group>
      <div v-if="importType === 'multi'">
        <v-list>
          <v-list-item>
            <v-text-field
              label="Left:"
              placeholder="Choose Folder"
              disabled
              :value="leftFolder"
              class="mx-4"
            />
            <v-btn
              color="primary"
              @click="open('image-sequence', 'left')"
            >
              Open Image Sequence
              <v-icon class="ml-2">
                mdi-folder-open
              </v-icon>
            </v-btn>
          </v-list-item>
          <v-list-item>
            <v-text-field
              label="Right:"
              placeholder="Choose Folder"
              disabled
              :value="rightFolder"
              class="mx-4"
            />
            <v-btn
              color="primary"
              @click="open('image-sequence', 'right')"
            >
              Open Image Sequence
              <v-icon class="ml-2">
                mdi-folder-open
              </v-icon>
            </v-btn>
          </v-list-item>
        </v-list>
      </div>
      <div v-if="importType ==='keyword'">
        <v-list-item>
          Folder:
          <v-text-field
            label="Folder:"
            placeholder="Choose Folder"
            disabled
            :value="keywordFolder"
            class="mx-4"
          />
          <v-btn
            color="primary"
            @click="open('image-sequence', 'keyword')"
          >
            Open Image Sequence
            <v-icon class="ml-2">
              mdi-folder-open
            </v-icon>
          </v-btn>
        </v-list-item>
        <v-list-item v-if="keywordFolder">
          <v-text-field
            v-model="globPatternLeft"
            label="Left Image Glob Filter Pattern "
            placeholder="Leave blank to use all images. example: *.png"
            persistent-hint
            outlined
            dense
          />
          <v-chip
            v-if="globPatternLeft"
            :color="filteredImagesLeft.length ? 'success' : 'error'"
            outlined
            class="ml-3 mb-5"
          >
            "{{ globPatternLeft }}" matches {{ filteredImagesLeft.length }}
            out of {{ pendingImportPayload.jsonMeta.originalImageFiles.length }} images
          </v-chip>
        </v-list-item>
        <v-list-item v-if="keywordFolder">
          <v-text-field
            v-model="globPatternRight"
            label="Right Image Glob Filter Pattern "
            placeholder="Leave blank to use all images. example: *.png"
            persistent-hint
            outlined
            dense
          />
          <v-chip
            v-if="globPatternRight"
            :color="filteredImagesRight.length ? 'success' : 'error'"
            outlined
            class="ml-3 mb-5"
          >
            "{{ globPatternRight }}" matches {{ filteredImagesRight.length }}
            out of {{ pendingImportPayload.jsonMeta.originalImageFiles.length }} images
          </v-chip>
        </v-list-item>
        <v-list-item
          v-if="keywordFolder && keywordReady !== 'Success'"
        >
          <v-alert
            type="error"
            outlined
            dense
          >
            {{ keywordReady }}
          </v-alert>
        </v-list-item>
      </div>
      <div v-if="nextSteps">
        <v-alert
          type="info"
          outlined
          dense
        >
          Visualization currently doesn't support stereoscopic views so please choose
          a list of images to display by default when viewing
        </v-alert>
        <v-list>
          <v-list-item>
            Default Display:
            <v-radio-group v-model="defaultDisplay">
              <v-radio
                value="left"
                label="left"
              />
              <v-radio
                value="right"
                label="right"
              />
            </v-radio-group>
          </v-list-item>
          <v-list-item>
            Optional Calibration File:
            <v-text-field
              label="Calibration File:"
              placeholder="Choose File"
              disabled
              :value="calibrationFile"
              class="mx-4"
            />
            <v-btn
              color="primary"
              @click="open('calibration', 'calibration')"
            >
              Open Calibration File
              <v-icon class="ml-2">
                mdi-matrix
              </v-icon>
            </v-btn>
          </v-list-item>
        </v-list>
      </div>
      <div class="d-flex flex-row mt-4">
        <v-spacer />
        <v-btn
          text
          outlined
          class="mr-5"
          @click="$emit('abort')"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!nextSteps"
          @click="prepForImport"
        >
          Begin Import
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped lang="scss">
@import './styles/KeyValueTable.scss';
</style>
