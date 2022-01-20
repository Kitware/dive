<script lang='ts'>
import {
  defineComponent, Ref, ref, computed,
} from '@vue/composition-api';

import {
  ImageSequenceType, VideoType, DefaultVideoFPS, FPSOptions,
  inputAnnotationFileTypes, websafeVideoTypes, otherVideoTypes,
  websafeImageTypes, otherImageTypes, JsonMetaRegEx,
} from 'dive-common/constants';

import ImportButton from 'dive-common/components/ImportButton.vue';
import ImportMultiCamDialog from 'dive-common/components/ImportMultiCamDialog.vue';
import { DatasetType, MultiCamImportArgs } from 'dive-common/apispec';
import { validateUploadGroup } from 'platform/web-girder/api';
import { openFromDisk } from 'platform/web-girder/utils';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { getResponseError } from 'vue-media-annotator/utils';
import { clientSettings } from 'dive-common/store/settings';
import UploadGirder from './UploadGirder.vue';

export interface InteralFiles {
  file: File;
  status: string | 'done' | 'pending' | 'error';
  progress: {
    indeterminate: boolean;
    current: number;
    size: number;
  };
  upload: null; //Mixin function
  result: null; //Mixin stuff
}

export interface PendingUpload {
  createSubFolders: boolean;
  name: string;
  files: InteralFiles[];
  meta: null | File;
  annotationFile: null | File;
  mediaList: File[];
  type: DatasetType | 'zip';
  fps: number;
  uploading: boolean;
}

interface GirderUpload {
  formatSize: (a: number) => string;
  totalProgress: number;
  totalProgressPercent: number;
  totalSize: number;
}

export default defineComponent({
  components: { ImportButton, ImportMultiCamDialog, UploadGirder },
  props: {
    location: {
      type: Object,
      required: true,
    },
  },
  setup(_, { emit }) {
    const preUploadErrorMessage: Ref<string | null> = ref(null);
    const pendingUploads: Ref<PendingUpload[]> = ref([]);
    const stereo = ref(false);
    const multiCamOpenType = ref('image-sequence');
    const importMultiCamDialog = ref(false);
    const girderUpload: Ref<null | GirderUpload> = ref(null);
    const { prompt } = usePrompt();

    const addPendingZipUpload = (name: string, allFiles: File[]) => {
      const fps = clientSettings.annotationFPS || DefaultVideoFPS;
      const defaultFilename = allFiles.length ? allFiles[0].name.replace(/\..*/, '') : 'Zip Upload';
      pendingUploads.value.push({
        createSubFolders: false,
        name: defaultFilename,
        files: [], //Will be set in the GirderUpload Component
        meta: null,
        annotationFile: null,
        mediaList: allFiles,
        type: 'zip',
        fps,
        uploading: false,
      });
    };

    const addPendingUpload = async (
      name: string,
      allFiles: File[],
      meta: File | null,
      annotationFile: File | null,
      mediaList: File[],
    ) => {
      const resp = (await validateUploadGroup(allFiles.map((f) => f.name))).data;
      if (!resp.ok) {
        if (resp.message) {
          preUploadErrorMessage.value = resp.message;
        }
        throw new Error(resp.message);
      }
      const fps = clientSettings.annotationFPS || DefaultVideoFPS;
      const defaultFilename = resp.media[0];
      const validFiles = resp.media.concat(resp.annotations);
      // mapping needs to be done for the mixin upload functions
      const internalFiles = allFiles
        .filter((f) => validFiles.includes(f.name));
      let createSubFolders = false;
      if (resp.type === 'video') {
        if (resp.media.length > 1) {
          createSubFolders = true;
        }
      }
      pendingUploads.value.push({
        createSubFolders,
        name:
          internalFiles.length > 1
            ? defaultFilename.replace(/\..*/, '')
            : defaultFilename,
        files: [], //Will be set in the GirderUpload Component
        meta,
        annotationFile,
        mediaList,
        type: resp.type,
        fps,
        uploading: false,
      });
    };
    /**
     * Processes the imported media files to distinguish between
     * Media Files - Default files that aren't the Annotation or Meta
     * Annotation File - CSV or JSON file, or more in the future
     * Meta File - Right now a json file which has 'meta' or 'config in the name
     */
    const processImport = (files: {
      canceled: boolean; filePaths: string[]; fileList?: File[];
    }) => {
      //Check for auto files for meta and annotations
      const output: {
        annotationFile: null | File;
        metaFile: null | File;
        mediaList: File[];
        fullList: File[];
      } = {
        annotationFile: null,
        metaFile: null,
        mediaList: [],
        fullList: [],
      };
      const jsonFiles: [string, number][] = [];
      const csvFiles: [string, number][] = [];
      if (files.fileList) {
        files.filePaths.forEach((item, index) => {
          if (item.indexOf('.json') !== -1) {
            jsonFiles.push([item, index]);
          } else if (item.indexOf('.csv') !== -1) {
            csvFiles.push([item, index]);
          }
        });
        output.mediaList = files.fileList.filter((item) => (
          item.name.indexOf('.json') === -1 && item.name.indexOf('.csv') === -1));
        const metaIndex = jsonFiles.findIndex((item) => (JsonMetaRegEx.test(item[0])));
        if (metaIndex !== -1) {
          output.metaFile = files.fileList[jsonFiles[metaIndex][1]];
          jsonFiles.splice(metaIndex, 1); //remove chosen meta from list
        }
        if (jsonFiles.length === 1 && csvFiles.length === 0) { // only remaining json file
          output.annotationFile = files.fileList[jsonFiles[0][1]];
        } else if (csvFiles.length) { // Prefer First CSV if both found
          output.annotationFile = files.fileList[csvFiles[0][1]];
        } else if (jsonFiles.length > 1) { //multiple jsons, filter out additional meta/configs
          const filtered = jsonFiles.filter((item) => (!JsonMetaRegEx.test(item[0]) && (item[0].indexOf('.json') !== -1)));
          if (filtered.length) { // take first filtered JSON file
            output.annotationFile = files.fileList[filtered[0][1]];
          }
        }
        output.fullList = [...output.mediaList];
        if (output.annotationFile) {
          output.fullList.push(output.annotationFile);
        }
        if (output.metaFile) {
          output.fullList.push(output.metaFile);
        }
      }
      return output;
    };
    /**
     * Initial opening of file dialog
     */
    const openImport = async (dstype: DatasetType | 'zip') => {
      const ret = await openFromDisk(dstype);
      if (!ret.canceled && ret.fileList) {
        const processed = processImport(ret);
        if (processed?.fullList?.length === 0) return;
        if (processed && processed.fullList) {
          const name = processed.fullList.length === 1 ? processed.fullList[0].name : '';
          preUploadErrorMessage.value = null;
          try {
            if (dstype !== 'zip') {
              await addPendingUpload(
                name, processed.fullList, processed.metaFile,
                processed.annotationFile, processed.mediaList,
              );
            } else {
              addPendingZipUpload(name, processed.fullList);
            }
          } catch (err) {
            preUploadErrorMessage.value = err.response?.data?.message || err;
          }
        }
      }
    };
    const openMultiCamDialog = (args: { stereo: boolean; openType: 'image-sequence' | 'video' }) => {
      stereo.value = args.stereo;
      multiCamOpenType.value = args.openType;
      importMultiCamDialog.value = true;
    };
    const filterFileUpload = (type: DatasetType | 'meta' | 'annotation') => {
      if (type === 'meta') {
        return '.json';
      } if (type === 'annotation') {
        return inputAnnotationFileTypes.map((item) => `.${item}`).join(',');
      } if (type === 'video') {
        return websafeVideoTypes.concat(otherVideoTypes);
      }
      return websafeImageTypes.concat(otherImageTypes);
    };

    // TODO:  Implementation of initialization organization of multiCam files into a return
    // of the MediaImportResponse defined in ImportMultiCamDialog.vue
    const multiCamImportCheck = (files: string[]) => ({
      jsonMeta: {
        originalImageFiles: files,
      },
      globPattern: '',
      mediaConvertList: [],
    });
    //TODO:  Implementation of the finalization of the Import.  Requires
    // Creation of an endpoint in the server which supports MultiCamImportArgs
    const multiCamImport = (args: MultiCamImportArgs) => {
      // eslint-disable-next-line no-console
      console.log(args);
    };
    // Filter to show how many files are left to upload
    const filesNotUploaded = (item: PendingUpload) => item.files.filter(
      (file) => file.status !== 'done' && file.status !== 'error',
    ).length;
    // Processes the pending upload from the GirderUpload system to determine the progress
    const computeUploadProgress = (pendingUpload: PendingUpload) => {
      // use methods and properties from mixins
      if (girderUpload.value) {
        //Need to use the girderUpload ref to get these values out of the mixin
        const { formatSize, totalProgress, totalSize } = girderUpload.value;
        if (pendingUpload.files.length === 1 && !pendingUpload.uploading) {
          return formatSize(pendingUpload.files[0].progress.size);
        } if (pendingUpload.type === ImageSequenceType) {
          return `${filesNotUploaded(pendingUpload)} files`;
        } if (pendingUpload.type === VideoType && !pendingUpload.uploading) {
          return `${filesNotUploaded(pendingUpload)} videos`;
        } if ((pendingUpload.type === VideoType || pendingUpload.type === 'zip') && pendingUpload.uploading) {
          // For videos we display the total progress when uploading because
          // single videos can be large
          return `${formatSize(totalProgress)} of ${formatSize(totalSize)}`;
        }
      }
      throw new Error(`could not determine adequate formatting for ${pendingUpload}`);
    };
    const getFilenameInputStateLabel = (pendingUpload: PendingUpload) => {
      const plural = pendingUpload.createSubFolders
        ? 's'
        : '';
      return `Folder Name${plural}`;
    };
    const getFilenameInputStateDisabled = (pendingUpload: PendingUpload) => (
      pendingUpload.uploading || (pendingUpload.createSubFolders && pendingUpload.type !== 'zip')
    );
    const getFilenameInputStateHint = (pendingUpload: PendingUpload) => (
      (pendingUpload.createSubFolders && pendingUpload.type !== 'zip') ? 'default folder names are used when "Create Subfolders" is selected' : ''
    );
    const getFilenameInputValue = (pendingUpload: PendingUpload) => (
      pendingUpload.createSubFolders && pendingUpload.type !== 'zip' ? 'default' : pendingUpload.name
    );
    const remove = (pendingUpload: PendingUpload) => {
      const index = pendingUploads.value.indexOf(pendingUpload);
      pendingUploads.value.splice(index, 1);
    };
    function close() {
      emit('close');
    }
    function abort() {
      if (pendingUploads.value.length === 0) {
        close();
      }
    }
    const uploading = computed(() => pendingUploads.value.some((v) => v.uploading));
    const buttonAttrs = computed(() => {
      if (pendingUploads.value.length === 0) {
        return {
          block: true,
          color: 'primary',
          disabled: uploading.value,
        };
      }
      return {
        block: true,
        color: 'grey darken-3',
        depressed: true,
        disabled: uploading.value,
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorHandler = async ({ err, name }: {err: any; name: string}) => {
      const text = getResponseError(err);
      await prompt({
        title: `${name}: Import Error`,
        text,
        positiveButton: 'OK',
      });
    };
    return {
      buttonAttrs,
      FPSOptions,
      preUploadErrorMessage,
      pendingUploads,
      stereo,
      multiCamOpenType,
      importMultiCamDialog,
      girderUpload,
      uploading,
      clientSettings,
      //methods
      close,
      openImport,
      processImport,
      openMultiCamDialog,
      filterFileUpload,
      multiCamImportCheck,
      multiCamImport,
      computeUploadProgress,
      getFilenameInputStateLabel,
      getFilenameInputValue,
      getFilenameInputStateDisabled,
      getFilenameInputStateHint,
      addPendingUpload,
      remove,
      abort,
      errorHandler,
    };
  },
});
</script>

<template>
  <div class="upload">
    <v-dialog
      :value="importMultiCamDialog"
      persistent
      overlay-opacity="0.95"
      max-width="80%"
    >
      <ImportMultiCamDialog
        v-if="importMultiCamDialog"
        :stereo="stereo"
        :data-type="multiCamOpenType"
        :import-media="multiCamImportCheck"
        @begin-multicam-import="multiCamImport($event)"
        @abort="importMultiCamDialog = false; preUploadErrorMessage = null"
      />
    </v-dialog>
    <v-card
      outlined
      color="default"
    >
      <v-toolbar
        flat
        dark
      >
        <v-toolbar-title>Upload datasets</v-toolbar-title>
        <v-spacer />
        <v-btn
          icon
          @click="close"
        >
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>
      <v-progress-linear
        v-show="girderUpload && girderUpload.totalProgressPercent"
        :value="girderUpload && girderUpload.totalProgressPercent"
        absolute
        height="6px"
      />
      <upload-girder
        ref="girderUpload"
        :pending-uploads="pendingUploads"
        :pre-upload-error-message="preUploadErrorMessage"
        :location="location"
        class="mx-6"
        @remove-upload="remove"
        @update:uploading="$emit('update:uploading', $event)"
        @abort="abort"
        @error="errorHandler"
      >
        <template #default="{ upload }">
          <v-card
            v-for="(pendingUpload, i) of pendingUploads"
            :key="i"
            outlined
            class="pa-4 my-4"
          >
            <v-row class="align-center">
              <v-col class="py-0">
                <v-text-field
                  :value="getFilenameInputValue(pendingUpload)"
                  class="upload-name"
                  :rules="[val => (val || '').length > 0 || 'This field is required']"
                  required
                  :label="getFilenameInputStateLabel(pendingUpload)"
                  :disabled="getFilenameInputStateDisabled(pendingUpload)"
                  :hint="getFilenameInputStateHint(pendingUpload)"
                  persistent-hint
                  @input="pendingUpload.name = $event"
                />
              </v-col>
              <v-col
                cols="3"
                class="py-0"
              >
                <v-select
                  v-model="pendingUpload.fps"
                  :items="FPSOptions"
                  :disabled="pendingUpload.uploading"
                  type="number"
                  required
                  label="FPS"
                  :append-icon="pendingUpload.annotationFile
                    ? 'mdi-alert' : 'mdi-chevron-down'"
                  :hint="pendingUpload.annotationFile
                    ? 'should match annotation fps' : 'annotation fps'"
                  persistent-hint
                  @change="clientSettings.annotationFPS = $event"
                />
              </v-col>
              <v-col
                cols="1"
                class="py-0"
              >
                <v-btn
                  icon
                  outlined
                  :disabled="pendingUpload.uploading"
                  @click="remove(pendingUpload)"
                >
                  <v-icon>mdi-close</v-icon>
                </v-btn>
              </v-col>
            </v-row>
            <v-row v-if="!pendingUpload.createSubFolders && pendingUpload.type !== 'zip'">
              <v-col class="py-0 mx-2">
                <v-row>
                  <v-file-input
                    v-model="pendingUpload.mediaList"
                    multiple
                    show-size
                    counter
                    :disabled="pendingUpload.uploading"
                    :prepend-icon="
                      pendingUpload.type === 'image-sequence'
                        ? 'mdi-image-multiple'
                        : 'mdi-file-video'
                    "
                    :label="
                      pendingUpload.type === 'image-sequence'
                        ? 'Image files'
                        : 'Video file'
                    "
                    :rules="[val => (val || '').length > 0 || 'Media Files are required']"
                    :accept="filterFileUpload(pendingUpload.type)"
                  />
                </v-row>
                <v-row>
                  <v-file-input
                    v-model="pendingUpload.annotationFile"
                    show-size
                    counter
                    prepend-icon="mdi-file-table"
                    label="Annotation File (Optional)"
                    hint="Optional"
                    :disabled="pendingUpload.uploading"
                    :accept="filterFileUpload('annotation')"
                  />
                </v-row>
                <v-row>
                  <v-file-input
                    v-model="pendingUpload.meta"
                    show-size
                    counter
                    label="Configuration File (Optional)"
                    hint="Optional"
                    :disabled="pendingUpload.uploading"
                    :accept="filterFileUpload('meta')"
                  />
                </v-row>
              </v-col>
            </v-row>
            <span v-if="uploading">
              {{ computeUploadProgress(pendingUpload) }} remaining
            </span>
          </v-card>
          <div
            class="d-flex my-6"
            :class="{
              'flex-column': pendingUploads.length === 0,
            }"
          >
            <import-button
              :name="`Add ${pendingUploads.length ? 'Another ' : ''}Image Sequence`"
              icon="mdi-folder-open"
              open-type="image-sequence"
              class="grow"
              :small="!!pendingUploads.length"
              :class="[pendingUploads.length ? 'mr-3' : 'my-3']"
              :button-attrs="buttonAttrs"
              @open="openImport($event)"
              @multi-cam="openMultiCamDialog"
            />
            <import-button
              :name="`Add ${pendingUploads.length ? 'Another ' : ''}Video`"
              icon="mdi-file-video"
              class="grow"
              :small="!!pendingUploads.length"
              :class="[pendingUploads.length ? 'ml-3' : 'my-3']"
              open-type="video"
              :button-attrs="buttonAttrs"
              @open="openImport($event)"
              @multi-cam="openMultiCamDialog"
            />
            <import-button
              :name="`Add ${pendingUploads.length ? 'Another ' : ''}Zip File`"
              icon="mdi-zip-box"
              class="grow"
              :small="!!pendingUploads.length"
              :class="[pendingUploads.length ? 'ml-3' : 'my-3']"
              open-type="zip"
              :button-attrs="buttonAttrs"
              @open="openImport($event)"
            />
          </div>
          <v-btn
            v-if="pendingUploads.length"
            :disabled="uploading"
            block
            large
            color="primary"
            class="my-6"
            @click="upload"
          >
            <v-icon class="pr-3">
              mdi-upload
            </v-icon>
            Start upload
          </v-btn>
        </template>
      </upload-girder>
    </v-card>
  </div>
</template>
