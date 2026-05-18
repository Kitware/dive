<script lang="ts">
import Vue, {
  computed, defineComponent, onMounted, ref, Ref, PropType, toRef,
} from 'vue';
import { filterByGlob } from 'platform/desktop/sharedUtils';
import {
  MediaImportResponse,
  DatasetType,
  useApi,
  MultiCamImportFolderArgs,
  MultiCamImportKeywordArgs,
} from 'dive-common/apispec';
import {
  commonPathPrefix,
  groupFilesByImmediateSubfolder,
  isValidCameraName,
  organizeSubfolderCameras,
} from 'dive-common/multicamSubfolderLayout';

import ImportMultiCamCameraGroup from 'dive-common/components/ImportMultiCamCameraGroup.vue';
import ImportMultiCamChooseSource from 'dive-common/components/ImportMultiCamChooseSource.vue';
import ImportMultiCamChooseAnnotation from 'dive-common/components/ImportMultiCamChooseAnnotation.vue';
import ImportMultiCamAddType from 'dive-common/components/ImportMultiCamAddType.vue';
import { ImageSequenceType, VideoType } from 'dive-common/constants';
import { useRequest } from 'dive-common/use';

export default defineComponent({
  name: 'ImportMultiCamDialog',
  components: {
    ImportMultiCamCameraGroup,
    ImportMultiCamChooseAnnotation,
    ImportMultiCamChooseSource,
    ImportMultiCamAddType,
  },
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
    enableSubfolderImport: {
      type: Boolean,
      default: false,
    },
    registerSubfolderCameras: {
      type: Function as PropType<(assignments: {
        cameraName: string;
        sourcePath: string;
        files: File[];
      }[]) => void>,
      default: undefined,
    },
    unregisterSubfolderCamera: {
      type: Function as PropType<(sourcePath: string) => void>,
      default: undefined,
    },
    renameSubfolderCamera: {
      type: Function as PropType<(oldSourcePath: string, newSourcePath: string) => void>,
      default: undefined,
    },
  },

  setup(props, { emit }) {
    const {
      openFromDisk, getLastCalibration, saveCalibration,
    } = useApi();
    const enableSubfolderImport = toRef(props, 'enableSubfolderImport');
    const importType: Ref<'multi' | 'keyword' | 'subfolders' | ''> = ref('');
    const folderList: Ref<Record<string, { sourcePath: string; trackFile: string}>> = ref({});
    const parentFolderName = ref('');
    const subfolderLayoutLabel = ref('');
    const keywordFolder = ref('');
    const pendingImportPayloads: Ref<Record<string, MediaImportResponse | null>> = ref({});
    const globList: Ref<Record<string, { glob: string; trackFile: string}>> = ref({});
    const calibrationFile = ref('');
    const datasetName = ref('');
    const subfolderOriginalNames: Ref<Record<string, string>> = ref({});
    const cameraOrder: Ref<string[]> = ref([]);
    const defaultDisplay = ref('left');
    const importAnnotationFilesCheck = ref(false);
    const { error: importError, request: importRequest } = useRequest();

    // Load default calibration for stereo imports
    onMounted(async () => {
      if (props.stereo && getLastCalibration) {
        const lastCalibration = await getLastCalibration();
        if (lastCalibration) {
          calibrationFile.value = lastCalibration;
        }
      }
    });

    const syncDefaultDisplay = () => {
      const keys = Object.keys(folderList.value);
      if (!keys.length) {
        return;
      }
      if (!keys.includes(defaultDisplay.value)) {
        if (keys.includes('center')) {
          defaultDisplay.value = 'center';
        } else if (keys.includes('port')) {
          defaultDisplay.value = 'port';
        } else if (keys.includes('left')) {
          defaultDisplay.value = 'left';
        } else {
          [defaultDisplay.value] = keys;
        }
      }
    };

    const clearCameraSet = () => {
      keywordFolder.value = '';
      parentFolderName.value = '';
      subfolderLayoutLabel.value = '';
      datasetName.value = '';
      subfolderOriginalNames.value = {};
      cameraOrder.value = [];
      defaultDisplay.value = props.stereo ? 'left' : 'center';
      if (props.stereo && importType.value === 'multi') {
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

      if (importType.value === 'multi' || importType.value === 'subfolders') {
        if (props.stereo && importType.value === 'multi') {
          pendingImportPayloads.value = {
            left: null,
            right: null,
          };
          cameraOrder.value = ['left', 'right'];
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

    const orderedCameraKeys = computed(() => {
      const keys = Object.keys(folderList.value);
      const ordered = cameraOrder.value.filter((key) => keys.includes(key));
      const remaining = keys.filter((key) => !ordered.includes(key));
      return [...ordered, ...remaining];
    });

    const displayKeys = computed(() => {
      if (importType.value === 'multi' || importType.value === 'subfolders') {
        return orderedCameraKeys.value;
      }
      if (importType.value === 'keyword') return Object.keys(globList.value);
      return [];
    });

    const canMoveCamera = (key: string, delta: number) => {
      const order = orderedCameraKeys.value;
      const index = order.indexOf(key);
      if (index === -1) {
        return false;
      }
      const target = index + delta;
      return target >= 0 && target < order.length;
    };

    const moveCamera = (key: string, delta: number) => {
      const order = [...orderedCameraKeys.value];
      const index = order.indexOf(key);
      if (index === -1) {
        return;
      }
      const target = index + delta;
      if (target < 0 || target >= order.length) {
        return;
      }
      order.splice(index, 1);
      order.splice(target, 0, key);
      cameraOrder.value = order;
    };

    const displayKeysKey = computed(() => displayKeys.value.join('|'));

    const camerasReady = computed(() => {
      if (importType.value !== 'multi' && importType.value !== 'subfolders') {
        return false;
      }
      const keys = Object.keys(folderList.value);
      if (!keys.length) {
        return false;
      }
      return keys.every(
        (key) => folderList.value[key].sourcePath !== ''
          && pendingImportPayloads.value[key] !== null,
      );
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

      if (importType.value === 'keyword' && Object.keys(globList.value).length === 0) {
        return 'Add at least 1 filter pattern';
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
        // Only check for overlapping filenames in keyword/glob mode where images
        // come from a single shared directory. In multi-folder mode, same filenames
        // in different directories are valid (e.g., stereo camera setups).
        if (importType.value === 'keyword'
            && totalList.some((imageName) => images.includes(imageName))) {
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
      if (importType.value === 'multi' || importType.value === 'subfolders') {
        return camerasReady.value && datasetName.value.trim().length > 0;
      }
      if (importType.value === 'keyword' && keywordFolder.value) {
        return true;
      }
      return false;
    });

    async function openParentFolder() {
      const ret = await openFromDisk(props.dataType, true);
      if (ret.canceled || !ret.fileList?.length) {
        return;
      }
      const paths = ret.fileList.map((f) => f.webkitRelativePath || f.name);
      const effectiveRoot = ret.root || commonPathPrefix(paths);
      const grouped = groupFilesByImmediateSubfolder(ret.fileList, effectiveRoot);
      const folderNames = [...grouped.keys()];
      await importRequest(async () => {
        const organized = organizeSubfolderCameras(folderNames);
        if (organized.error) {
          throw new Error(organized.error);
        }
        parentFolderName.value = effectiveRoot.split('/').pop() || effectiveRoot || 'parent folder';
        subfolderLayoutLabel.value = organized.layoutLabel;
        if (!datasetName.value.trim()) {
          datasetName.value = parentFolderName.value;
        }

        const registryPayload = organized.assignments.map((assignment) => ({
          cameraName: assignment.cameraName,
          sourcePath: assignment.sourcePath,
          files: grouped.get(assignment.folderName) ?? [],
        }));
        if (props.registerSubfolderCameras) {
          props.registerSubfolderCameras(registryPayload);
        }

        folderList.value = {};
        pendingImportPayloads.value = {};
        subfolderOriginalNames.value = {};
        cameraOrder.value = registryPayload.map((item) => item.cameraName);

        for (let i = 0; i < registryPayload.length; i += 1) {
          const { cameraName, sourcePath, files } = registryPayload[i];
          if (!files.length) {
            throw new Error(`Subfolder "${organized.assignments[i].folderName}" has no media files`);
          }
          Vue.set(subfolderOriginalNames.value, cameraName, organized.assignments[i].folderName);
          Vue.set(folderList.value, cameraName, { sourcePath, trackFile: '' });
          Vue.set(
            pendingImportPayloads.value,
            cameraName,
            await props.importMedia(sourcePath),
          );
        }
        defaultDisplay.value = organized.defaultDisplay;
        syncDefaultDisplay();
      });
    }

    function renameCamera(oldKey: string, newName: string) {
      const newKey = (typeof newName === 'string' ? newName : '').trim();
      if (!newKey || newKey === oldKey) {
        return;
      }
      if (!isValidCameraName(newKey)) {
        throw new Error('Camera name must be letters and numbers only');
      }
      if (folderList.value[newKey]) {
        throw new Error(`Camera name "${newKey}" already exists`);
      }
      const entry = folderList.value[oldKey];
      const payload = pendingImportPayloads.value[oldKey];
      const original = subfolderOriginalNames.value[oldKey];
      const { sourcePath } = entry;

      if (importType.value === 'subfolders' && props.renameSubfolderCamera) {
        props.renameSubfolderCamera(sourcePath, newKey);
      }

      Vue.set(folderList.value, newKey, {
        sourcePath: importType.value === 'subfolders' ? newKey : sourcePath,
        trackFile: entry.trackFile,
      });
      Vue.delete(folderList.value, oldKey);

      if (payload !== undefined) {
        Vue.set(pendingImportPayloads.value, newKey, payload);
        Vue.delete(pendingImportPayloads.value, oldKey);
      }
      if (original) {
        Vue.set(subfolderOriginalNames.value, newKey, original);
        Vue.delete(subfolderOriginalNames.value, oldKey);
      }
      if (defaultDisplay.value === oldKey) {
        defaultDisplay.value = newKey;
      }
      cameraOrder.value = cameraOrder.value.map((k) => (k === oldKey ? newKey : k));
      syncDefaultDisplay();
    }

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
          // Save user-selected calibration as the new default
          if (saveCalibration) {
            saveCalibration(path);
          }
        } else if (importType.value === 'multi') {
          if (ret.root) {
            folderList.value[folder].sourcePath = ret.root;
          } else {
            folderList.value[folder].sourcePath = path;
          }
          folderList.value[folder].trackFile = '';
          const { sourcePath } = folderList.value[folder];
          Vue.set(
            pendingImportPayloads.value,
            folder,
            await importRequest(() => props.importMedia(sourcePath)),
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
      if (importType.value === 'multi' || importType.value === 'subfolders') {
        const { sourcePath } = folderList.value[key];
        if (importType.value === 'subfolders' && props.unregisterSubfolderCamera) {
          props.unregisterSubfolderCamera(sourcePath);
        }
        Vue.delete(folderList.value, key);
        Vue.delete(pendingImportPayloads.value, key);
        Vue.delete(subfolderOriginalNames.value, key);
        cameraOrder.value = cameraOrder.value.filter((k) => k !== key);
        syncDefaultDisplay();
      } else if (importType.value === 'keyword') {
        Vue.delete(globList.value, key);
      }
    };

    async function onRenameCamera(oldKey: string, newName: string) {
      try {
        renameCamera(oldKey, newName);
      } catch (err) {
        await importRequest(() => Promise.reject(err));
      }
    }
    const addNewSet = (name: string) => {
      if (importType.value === 'multi') {
        Vue.set(folderList.value, name, { sourcePath: '', trackFile: '' });
        Vue.set(pendingImportPayloads.value, name, null);
        cameraOrder.value = [...cameraOrder.value, name];
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
      if (importType.value === 'multi' || importType.value === 'subfolders') {
        const sourceList: MultiCamImportFolderArgs['sourceList'] = {};
        orderedCameraKeys.value.forEach((key) => {
          if (folderList.value[key]) {
            sourceList[key] = folderList.value[key];
          }
        });
        const args: MultiCamImportFolderArgs = {
          datasetName: datasetName.value.trim(),
          defaultDisplay: defaultDisplay.value,
          cameraOrder: orderedCameraKeys.value,
          sourceList,
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

    const datasetNameRules = [
      (val: string) => (val || '').trim().length > 0 || 'Dataset name is required',
    ];

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
      displayKeysKey,
      orderedCameraKeys,
      camerasReady,
      canMoveCamera,
      moveCamera,
      importAnnotationFilesCheck,
      parentFolderName,
      subfolderLayoutLabel,
      subfolderOriginalNames,
      datasetName,
      datasetNameRules,
      enableSubfolderImport,
      //Methods
      open,
      openParentFolder,
      prepForImport,
      addNewSet,
      clearCameraSet,
      deleteSet,
      onRenameCamera,
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
      <div v-if="dataType === 'image-sequence' || enableSubfolderImport">
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
            v-if="enableSubfolderImport"
            value="subfolders"
            label="Parent folder: each immediate subfolder is a camera"
          />
          <v-radio
            v-if="dataType === 'image-sequence'"
            value="keyword"
            label="Glob Filter: Use pattern matching to deteremine left and right camera"
          />
        </v-radio-group>
      </div>

      <div v-if="importType === 'subfolders'">
        <v-alert
          type="info"
          outlined
          dense
          class="mb-3"
        >
          Choose a parent folder containing one subfolder per camera (2 or 3 subfolders).
          Each subfolder name becomes the camera name (letters and numbers only).
        </v-alert>
        <v-row
          no-gutters
          class="align-center mb-3"
        >
          <v-text-field
            label="Parent folder"
            placeholder="Not selected"
            disabled
            outlined
            dense
            hide-details
            :value="parentFolderName"
            class="mr-3"
          />
          <v-btn
            color="primary"
            @click="openParentFolder"
          >
            Choose parent folder
            <v-icon class="ml-2">
              mdi-folder-open
            </v-icon>
          </v-btn>
        </v-row>
        <v-alert
          v-if="subfolderLayoutLabel"
          type="success"
          outlined
          dense
          class="mb-3"
        >
          Cameras: {{ subfolderLayoutLabel }}
        </v-alert>
        <ImportMultiCamCameraGroup
          v-for="key in orderedCameraKeys"
          :key="key"
          :camera-name="key"
          :show-delete="true"
          class="mb-3"
          @delete="deleteSet(key)"
        >
          <v-row
            no-gutters
            class="align-center mb-2"
          >
            <v-btn
              icon
              small
              :disabled="!canMoveCamera(key, -1)"
              @click="moveCamera(key, -1)"
            >
              <v-icon>mdi-arrow-up</v-icon>
            </v-btn>
            <v-btn
              icon
              small
              class="mr-2"
              :disabled="!canMoveCamera(key, 1)"
              @click="moveCamera(key, 1)"
            >
              <v-icon>mdi-arrow-down</v-icon>
            </v-btn>
            <v-text-field
              :value="key"
              label="Camera name"
              hint="Used as the Girder folder name for this camera"
              persistent-hint
              dense
              outlined
              hide-details="auto"
              class="flex-grow-1"
              @change="onRenameCamera(key, $event)"
            />
          </v-row>
          <ImportMultiCamChooseSource
            :camera-name="key"
            :data-type="dataType"
            :value="subfolderOriginalNames[key] || key"
            :hide-actions="true"
          />
          <v-chip
            v-if="pendingImportPayloads[key]"
            :color="pendingImportPayloads[key].jsonMeta.originalImageFiles.length ? 'success' : 'error'"
            outlined
            class="mt-2"
          >
            {{ pendingImportPayloads[key].jsonMeta.originalImageFiles.length }} files
          </v-chip>
        </ImportMultiCamCameraGroup>
        <div v-if="camerasReady">
          <v-text-field
            v-model="datasetName"
            label="Dataset name"
            placeholder="Parent folder name in Girder"
            hint="A new folder with this name will contain all cameras"
            persistent-hint
            outlined
            dense
            class="mb-4 mt-2"
            :rules="datasetNameRules"
          />
          <v-alert
            type="info"
            outlined
            dense
            class="mb-3"
          >
            Choose which camera to use as the default display when viewing the dataset.
          </v-alert>
          <v-radio-group
            :key="displayKeysKey"
            v-model="defaultDisplay"
            label="Default Display"
          >
            <v-radio
              v-for="cameraKey in displayKeys"
              :key="cameraKey"
              :value="cameraKey"
              :label="cameraKey"
            />
          </v-radio-group>
          <v-row
            v-if="stereo"
            no-gutters
            class="align-center mt-2"
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

      <!-- Multicam Builder -->
      <div v-if="importType === 'multi'">
        <ImportMultiCamCameraGroup
          v-for="key in orderedCameraKeys"
          :key="key"
          :camera-name="key"
          :show-delete="!stereo"
          class="mb-3"
          @delete="deleteSet(key)"
        >
          <v-row
            v-if="orderedCameraKeys.length > 1"
            no-gutters
            class="align-center mb-2"
          >
            <v-btn
              icon
              small
              :disabled="!canMoveCamera(key, -1)"
              @click="moveCamera(key, -1)"
            >
              <v-icon>mdi-arrow-up</v-icon>
            </v-btn>
            <v-btn
              icon
              small
              class="mr-2"
              :disabled="!canMoveCamera(key, 1)"
              @click="moveCamera(key, 1)"
            >
              <v-icon>mdi-arrow-down</v-icon>
            </v-btn>
          </v-row>
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
              v-if="folderList[key].sourcePath && importAnnotationFilesCheck"
              :camera-name="key"
              :track-file="folderList[key].trackFile"
              class="my-3"
              @clear="folderList[key].trackFile = ''"
              @open="openAnnotationFile(key)"
            />
          </template>
        </ImportMultiCamCameraGroup>
        <ImportMultiCamAddType
          v-if="!stereo"
          :name-list="displayKeys"
          class="my-3"
          @add-new="addNewSet"
        />
      </div>

      <!-- Keyword Builder -->
      <div v-else-if="importType === 'keyword'">
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
      <div v-if="nextSteps && importType !== 'subfolders'">
        <v-alert
          type="info"
          outlined
          dense
        >
          Visualization currently doesn't support multi views so please choose
          a list of images or video to display by default when viewing
        </v-alert>
        <div>
          <v-text-field
            v-model="datasetName"
            label="Dataset name"
            placeholder="Parent folder name in Girder"
            hint="A new folder with this name will contain all cameras"
            persistent-hint
            outlined
            dense
            class="mb-4"
            :rules="datasetNameRules"
          />
          <div v-if="camerasReady">
            <v-radio-group
              :key="displayKeysKey"
              v-model="defaultDisplay"
              label="Default Display"
            >
              <v-radio
                v-for="cameraKey in displayKeys"
                :key="cameraKey"
                :value="cameraKey"
                :label="cameraKey"
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
          :disabled="!nextSteps"
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
