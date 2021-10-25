<script lang="ts">
import Vue from 'vue';
import {
  computed, defineComponent, ref, Ref, PropType,
} from '@vue/composition-api';
import { filterByGlob } from 'platform/desktop/sharedUtils';
import {
  MediaImportResponse,
  DatasetType,
  useApi,
  MultiCamImportFolderArgs,
  MultiCamImportKeywordArgs,
} from 'dive-common/apispec';

import ImportMultiCamCameraGroup from 'dive-common/components/ImportMultiCamCameraGroup.vue';
import ImportMultiCamChooseSource from 'dive-common/components/ImportMultiCamChooseSource.vue';
import ImportMultiCamChooseAnnotation from 'dive-common/components/ImportMultiCamChooseAnnotation.vue';
import ImportMultiCamAddType from 'dive-common/components/ImportMultiCamAddType.vue';
import { ImageSequenceType, VideoType } from 'dive-common/constants';
import { useRequest } from 'dive-common/use';

export default defineComponent({
  components: {
    ImportMultiCamCameraGroup,
    ImportMultiCamChooseAnnotation,
    ImportMultiCamChooseSource,
    ImportMultiCamAddType,
  },
  name: 'ImportMultiCamDialog',
  props: {
    stereo: {
      type: Boolean as PropType<boolean>,
      required: false,
    },
    dataType: {
      type: String as PropType<typeof VideoType | typeof ImageSequenceType>,
      default: ImageSequenceType,
    },
    importMedia: {
      type: Function as PropType<(path: string) => Promise<MediaImportResponse>>,
      required: true,
    },
  },

  setup(props, { emit }) {
    const { openFromDisk } = useApi();
    const importType: Ref<'multi'|'keyword'| ''> = ref('');
    const folderList: Ref<Record<string, { sourcePath: string; trackFile: string}>> = ref({});
    const keywordFolder = ref('');
    const pendingImportPayloads: Ref<Record<string, MediaImportResponse | null>> = ref({});
    const globList: Ref<Record<string, { glob: string; trackFile: string}>> = ref({});
    const calibrationFile = ref('');
    const defaultDisplay = ref('left');
    const importAnnotationFilesCheck = ref(false);
    const { error: importError, request: importRequest } = useRequest();

    const clearCameraSet = () => {
      keywordFolder.value = '';
      if (props.stereo) {
        folderList.value = {
          left: { sourcePath: '', trackFile: '' },
          right: { sourcePath: '', trackFile: '' },
        };
        globList.value = {
          left: { glob: '', trackFile: '' },
          right: { glob: '', trackFile: '' },
        };
      } else {
        folderList.value = {};
        globList.value = {};
      }

      if (importType.value === 'multi') {
        if (props.stereo) {
          pendingImportPayloads.value = {
            left: null,
            right: null,
          };
        } else {
          pendingImportPayloads.value = {};
        }
      } else if (importType.value === 'keyword') {
        pendingImportPayloads.value = { keyword: null };
      }
    };
    clearCameraSet();

    if (props.dataType === VideoType) {
      importType.value = 'multi';
    }

    const displayKeys = computed(() => {
      if (importType.value === 'multi') return Object.keys(folderList.value);
      if (importType.value === 'keyword') return Object.keys(globList.value);
      return [];
    });

    const globImages = computed(() => {
      const filtered: Record<string, string[]> = {};
      Object.entries(globList.value).forEach(([cameraName, val]) => {
        const payload = pendingImportPayloads.value.keyword;
        filtered[cameraName] = filterByGlob(val.glob, payload?.jsonMeta.originalImageFiles);
      });
      return filtered;
    });

    const folderImages = computed(() => {
      const filtered: Record<string, string[]> = {};
      Object.entries(folderList.value).forEach(([cameraName]) => {
        const payload = pendingImportPayloads.value[cameraName];
        filtered[cameraName] = payload?.jsonMeta.originalImageFiles || [];
      });
      return filtered;
    });

    const filteredImages = computed(() => (importType.value === 'keyword'
      ? globImages.value : folderImages.value));

    const errorMessage = computed(() => {
      if (importError.value) {
        return importError.value;
      }

      if (
        Object.values(pendingImportPayloads.value).length === 0
        || Object.values(pendingImportPayloads.value).some((v) => v === null)
        || importType.value === ''
      ) {
        /* Wait until every image list has been loaded successfully to check more */
        return null;
      }

      if (props.dataType === 'video') {
        return null;
      }

      const entries = Object.entries(filteredImages.value);
      let length = -1;
      let totalList: string[] = [];

      for (let i = 0; i < entries.length; i += 1) {
        const [cameraName, images] = entries[i];
        if (!images.length) {
          return `Requires filtered Images for ${cameraName} `;
        } if (length === -1) {
          length = images.length;
        }
        if (length !== images.length) {
          return `All cameras should have the same length of ${length}`;
        }
        if (totalList.some((imageName) => images.includes(imageName))) {
          return 'Overlapping values.  All cameras must consist of mutually exclusive images.';
        }
        totalList = totalList.concat(images);
      }
      return null;
    });

    const nextSteps = computed(() => {
      if (errorMessage.value !== null) {
        return false;
      }
      if (importType.value === 'multi') {
        const entries = Object.entries(folderList.value);
        const filterLength = entries.filter(([, val]) => val.sourcePath !== '').length;
        if (entries.length === filterLength && entries.length) {
          return true;
        }
        return false;
      }
      if (importType.value === 'keyword' && keywordFolder.value) {
        return true;
      }
      return false;
    });

    async function openAnnotationFile(folder: string) {
      const ret = await openFromDisk('annotation');
      if (!ret.canceled) {
        if (ret.filePaths?.length) {
          const path = ret.filePaths[0];
          folderList.value[folder].trackFile = path;
        }
      }
    }

    async function open(dstype: DatasetType | 'calibration' | 'text', folder: string | 'calibration') {
      const ret = await openFromDisk(dstype, dstype === 'image-sequence');
      if (!ret.canceled) {
        const path = ret.filePaths[0];
        if (folder === 'calibration') {
          calibrationFile.value = path;
        } else if (importType.value === 'multi') {
          if (ret.root) {
            folderList.value[folder].sourcePath = ret.root;
          } else {
            folderList.value[folder].sourcePath = path;
          }
          folderList.value[folder].trackFile = '';
          Vue.set(
            pendingImportPayloads.value,
            folder,
            await importRequest(() => props.importMedia(path)),
          );
        } else if (importType.value === 'keyword') {
          [keywordFolder.value] = ret.filePaths;
          if (ret.root) {
            keywordFolder.value = ret.root;
          }
          pendingImportPayloads.value.keyword = await importRequest(() => props.importMedia(path));
        }
      }
    }

    const deleteSet = (key: string) => {
      if (importType.value === 'multi') {
        Vue.delete(folderList.value, key);
        Vue.delete(pendingImportPayloads.value, key);
      } else if (importType.value === 'keyword') {
        Vue.delete(globList.value, key);
      }
    };
    const addNewSet = (name: string) => {
      if (importType.value === 'multi') {
        Vue.set(folderList.value, name, { sourcePath: '', trackFile: '' });
        Vue.set(pendingImportPayloads.value, name, null);
      } else if (importType.value === 'keyword') {
        Vue.set(globList.value, name, { glob: '', trackFile: '' });
      }
    };

    const prepForImport = () => {
      if (!importAnnotationFilesCheck.value) {
        Object.keys(folderList.value).forEach((key) => {
          folderList.value[key].trackFile = '';
        });
      }
      if (importType.value === 'multi') {
        const args: MultiCamImportFolderArgs = {
          defaultDisplay: defaultDisplay.value,
          sourceList: folderList.value,
          calibrationFile: calibrationFile.value,
          type: props.dataType,
        };
        emit('begin-multicam-import', args);
      } else if (importType.value === 'keyword') {
        const args: MultiCamImportKeywordArgs = {
          defaultDisplay: defaultDisplay.value,
          sourcePath: keywordFolder.value,
          globList: globList.value,
          calibrationFile: calibrationFile.value,
          type: 'image-sequence',
        };
        emit('begin-multicam-import', args);
      }
    };

    return {
      errorMessage,
      nextSteps,
      importType,
      folderList,
      keywordFolder,
      pendingImportPayloads,
      globList,
      filteredImages,
      calibrationFile,
      defaultDisplay,
      displayKeys,
      importAnnotationFilesCheck,
      //Methods
      open,
      prepForImport,
      addNewSet,
      clearCameraSet,
      deleteSet,
      openAnnotationFile,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="import-card px-3"
  >
    <v-card-title class="text-h5">
      Import {{ stereo ? 'Stereo' : 'Multi-Camera' }}
      {{ dataType === 'image-sequence' ? 'Image Sequence' : 'Videos' }}
    </v-card-title>
    <v-card-text>
      <div v-if="dataType === 'image-sequence'">
        <v-radio-group
          v-model="importType"
          label="How do you want to choose each camera?"
          @change="clearCameraSet"
        >
          <v-radio
            value="multi"
            label="Multi-Folder: Choose a folder or image list for each camera"
          />
          <v-radio
            value="keyword"
            label="Glob Filter: Use pattern matching to deteremine left and right camera"
          />
        </v-radio-group>
      </div>

      <!-- Multicam Builder -->
      <div v-if="importType === 'multi'">
        <ImportMultiCamCameraGroup
          v-for="(item, key) in folderList"
          :key="key"
          :camera-name="key"
          :show-delete="!stereo"
          class="mb-3"
          @delete="deleteSet(key)"
        >
          <template>
            <ImportMultiCamChooseSource
              :camera-name="key"
              :data-type="dataType"
              :stereo="stereo"
              :show-delete="!stereo"
              :value="folderList[key].sourcePath"
              @open="open(dataType, key)"
              @open-text="open('text', key)"
              @delete="deleteSet(key)"
            />
            <ImportMultiCamChooseAnnotation
              v-if="item.sourcePath && importAnnotationFilesCheck"
              :camera-name="key"
              :track-file="item.trackFile"
              class="my-3"
              @clear="item.trackFile = ''"
              @open="openAnnotationFile(key)"
            />
          </template>
        </ImportMultiCamCameraGroup>
        <ImportMultiCamAddType
          v-if="!stereo"
          :name-list="displayKeys"
          @add-new="addNewSet"
        />
      </div>

      <!-- Keyword Builder -->
      <div v-else-if="importType ==='keyword'">
        <ImportMultiCamChooseSource
          camera-name="Folder or Image List"
          :data-type="dataType"
          :value="keywordFolder"
          class="mb-3"
          @open="open(dataType, 'keyword')"
          @open-text="open('text', 'keyword')"
        />
        <ImportMultiCamCameraGroup
          v-for="(item, key) in globList"
          :key="key"
          :camera-name="key"
          :show-delete="!stereo"
          class="mb-3"
          @delete="deleteSet(key)"
        >
          <v-row
            class="align-center my-3"
            no-gutters
          >
            <v-text-field
              v-model="globList[key].glob"
              label="Glob Filter Pattern"
              placeholder="Leave blank to use all images. example: *.png"
              outlined
              dense
              hide-details
            />
            <v-chip
              v-if="globList[key].glob && pendingImportPayloads.keyword"
              :color="filteredImages[key].length ? 'success' : 'error'"
              outlined
              class="ml-3"
            >
              "{{ globList[key].glob }}" matches {{ filteredImages[key].length }}
              out of {{ pendingImportPayloads.keyword.jsonMeta.originalImageFiles.length }} images
            </v-chip>
          </v-row>
          <ImportMultiCamChooseAnnotation
            v-if="item.glob && importAnnotationFilesCheck"
            :camera-name="key"
            :track-file="item.trackFile"
            class="my-3"
            @clear="item.trackFile = ''"
            @open="openAnnotationFile(key)"
          />
        </ImportMultiCamCameraGroup>
        <ImportMultiCamAddType
          v-if="!stereo"
          :name-list="displayKeys"
          class="my-3"
          @add-new="addNewSet"
        />
      </div>

      <!-- Default Camera Selector and Error Messages -->
      <div>
        <v-alert
          v-if="errorMessage"
          type="error"
          outlined
          dense
        >
          {{ errorMessage }}
        </v-alert>
      </div>
      <div v-if="nextSteps">
        <v-alert
          type="info"
          outlined
          dense
        >
          Visualization currently doesn't support multi views so please choose
          a list of images or video to display by default when viewing
        </v-alert>
        <div>
          <div>
            <v-radio-group
              v-model="defaultDisplay"
              label="Default Display"
            >
              <v-radio
                v-for="(item,index) in displayKeys"
                :key="index"
                :value="item"
                :label="item"
              />
            </v-radio-group>
          </div>
          <v-row
            v-if="stereo"
            no-gutters
            class="align-center"
          >
            <v-text-field
              label="Calibration File:"
              placeholder="Choose File"
              disabled
              outlined
              dense
              hide-details
              :value="calibrationFile"
              class="mr-3"
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
          </v-row>
        </div>
      </div>

      <!-- Action Items -->
      <v-row
        no-gutters
        class="align-center"
      >
        <v-checkbox
          v-if="importType"
          v-model="importAnnotationFilesCheck"
          label="Import Annotations"
          dense
          persistent-hint
        />
        <v-spacer />
        <v-btn
          text
          outlined
          class="mr-3"
          @click="$emit('abort')"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!nextSteps || (stereo && !calibrationFile)"
          @click="prepForImport"
        >
          Begin Import
        </v-btn>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<style lang="scss" scoped>
@import 'dive-common/components/styles/KeyValueTable.scss';
</style>
