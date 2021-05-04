<script lang='ts'>
import { defineComponent, Ref, ref } from '@vue/composition-api';

import {
  ImageSequenceType, VideoType, DefaultVideoFPS, inputAnnotationFileTypes,
  websafeVideoTypes, otherVideoTypes, websafeImageTypes, otherImageTypes,
} from 'dive-common/constants';

import ImportButton from 'dive-common/components/ImportButton.vue';
import ImportMultiCamDialog from 'dive-common/components/ImportMultiCamDialog.vue';
import { DatasetType } from 'dive-common/apispec';
import GirderUpload from './GirderUpload.vue';
import {
  validateUploadGroup, openFromDisk,
} from '../api/viame.service';


interface InteralFiles {
   file: File;
  status: string |'done' | 'pending' | 'error';
  progress: {
    indeterminate: boolean;
    current: number;
    size: number;
  };
  upload: null; //Mixin function
  result: null; //Mixin stuff
}

interface PendingUpload {
   createSubFolders: boolean;
    name: string;
    files: InteralFiles[];
    meta: null | File;
    annotationFile: null | File;
    mediaList: File[];
    type: DatasetType;
    fps: number;
    uploading: boolean;
}
interface GirderUpload {
  formatSize: (a: number) => string;
  totalProgress: number;
  totalSize: number;
}

export default defineComponent({
  components: { ImportButton, ImportMultiCamDialog, GirderUpload },
  props: {
    location: {
      type: Object,
      required: true,
    },
  },
  setup() {
    const preUploadErrorMessage: Ref<string | null> = ref(null);
    const pendingUploads: Ref<PendingUpload[]> = ref([]);
    const imageSequenceType = ref('image-sequence');
    const stereo = ref(false);
    const multiCamOpenType = ref('image-sequence');
    const importMultiCamDialog = ref(false);
    const girderUpload: Ref<null | GirderUpload > = ref(null);
    const openImport = async (dstype: DatasetType) => {
      const ret = await openFromDisk(dstype);
      if (!ret.canceled && ret.fileList) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const processed = processImport(ret);
        if (processed?.fullList?.length === 0) return;
        if (processed && processed.fullList) {
          const name = processed.fullList.length === 1 ? processed.fullList[0].name : '';
          preUploadErrorMessage.value = null;
          try {
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            await addPendingUpload(
              name, processed.fullList, processed.metaFile,
              processed.annotationFile, processed.mediaList,
            );
          } catch (err) {
            preUploadErrorMessage.value = err;
          }
        }
      }
    };
    const processImport = (files: { canceled: boolean; filePaths: string[]; fileList?: File[]}) => {
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
        output.mediaList = files.fileList.filter((item) => (item.name.indexOf('.json') === -1 && item.name.indexOf('.csv') === -1));
        const metaIndex = jsonFiles.findIndex((item) => (item.indexOf('meta') !== -1));
        if (metaIndex !== -1) {
          output.metaFile = files.fileList[jsonFiles[metaIndex][1]];
        }
        if (jsonFiles.length === 1 && csvFiles.length === 0 && output.metaFile !== null) {
          output.annotationFile = files.fileList[jsonFiles[0][1]];
        } else if (csvFiles.length && jsonFiles.length === 1) {
          if (jsonFiles[0][0].indexOf('meta') !== -1) {
            output.annotationFile = files.fileList[csvFiles[0][1]];
            output.metaFile = files.fileList[jsonFiles[0][1]];
          }
        } else if (jsonFiles.length > 1) {
        //Check for a meta
          const filtered = jsonFiles.filter((item) => (item.indexOf('meta') === -1));
          if (filtered.length === 1) {
            output.annotationFile = files.fileList[filtered[0][1]];
          }
        } else if (csvFiles.length) {
          output.annotationFile = files.fileList[csvFiles[0][1]];
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
    const openMultiCamDialog = (args: {stereo: boolean; openType: 'image-sequence' | 'video'}) => {
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

    const multiCamImportCheck = (files: string[]) => ({
      jsonMeta: {
        originalImageFiles: files,
      },
      globPattern: '',
      mediaConvertList: [],

    });
    const multiCamImport = (args: string) => {
      console.log(args);
    };
    // Filter to show how many images are left to upload
    const filesNotUploaded = (item: PendingUpload) => item.files.filter(
      (file) => file.status !== 'done' && file.status !== 'error',
    ).length;
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
        } if (pendingUpload.type === VideoType && pendingUpload.uploading) {
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
      pendingUpload.uploading || pendingUpload.createSubFolders
    );
    const getFilenameInputStateHint = (pendingUpload: PendingUpload) => (
      pendingUpload.createSubFolders ? 'default folder names are used when "Create Subfolders" is selected' : ''
    );
    const addPendingUpload = async (
      name: string,
      allFiles: File[],
      meta: File | null,
      annotationFile: File | null,
      mediaList: File[],
    ) => {
      const resp = await validateUploadGroup(allFiles.map((f) => f.name));
      if (!resp.ok) {
        if (resp.message) {
          preUploadErrorMessage.value = resp.message;
        }
        throw new Error(resp.message);
      }
      const fps = resp.type === ImageSequenceType ? 5 : DefaultVideoFPS;
      const defaultFilename = resp.media[0];
      const validFiles = resp.media.concat(resp.annotations);
      // mapping needs to be done for the mixin upload functions
      const internalFiles = allFiles
        .filter((f) => validFiles.includes(f.name))
        .map((file) => ({
          file,
          status: 'pending',
          progress: {
            indeterminate: false,
            current: 0,
            size: file.size,
          },
          upload: null,
          result: null,
        }));
      // decide on the default createSubFolders based on content uploaded
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
        files: internalFiles,
        meta,
        annotationFile,
        mediaList,
        type: resp.type,
        fps,
        uploading: false,
      });
    };
    const remove = (pendingUpload: PendingUpload) => {
      const index = pendingUploads.value.indexOf(pendingUpload);
      pendingUploads.value.splice(index, 1);
    };
    return {

      preUploadErrorMessage,
      pendingUploads,
      imageSequenceType,
      stereo,
      multiCamOpenType,
      importMultiCamDialog,
      girderUpload,
      //methods
      openImport,
      processImport,
      openMultiCamDialog,
      filterFileUpload,
      multiCamImportCheck,
      multiCamImport,
      computeUploadProgress,
      getFilenameInputStateLabel,
      getFilenameInputStateDisabled,
      getFilenameInputStateHint,
      addPendingUpload,
      remove,
    };
  },
});
</script>

<template>
  <div class="upload">
    <v-dialog
      :value=" importMultiCamDialog"
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
        @abort="importMultiCamDialog = false"
      />
    </v-dialog>
    <girder-upload
      ref="girderUpload"
      :pending-uploads="pendingUploads"
      :pre-upload-error-message="preUploadErrorMessage"
      :location="location"
      @remove-upload="remove"
      @update:uploading="$emit('update:uploading', $event)"
    >
      <template slot="upload-list">
        <v-list class="py-2 pending-uploads">
          <v-list-item
            v-for="(pendingUpload, i) of pendingUploads"
            :key="i"
          >
            <v-list-item-content>
              <v-card>
                <v-row>
                  <v-col cols="auto">
                    <v-checkbox
                      :input-value="pendingUpload.createSubFolders"
                      label="Create Subfolders"
                      disabled
                      hint="Enabled when many videos are selected"
                      persistent-hint
                      class="pl-2"
                    />
                  </v-col>
                  <v-col>
                    <v-text-field
                      :value="pendingUpload.createSubFolders ? 'default' : pendingUpload.name"
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
                  <v-col cols="1">
                    <v-list-item-action>
                      <v-btn
                        class="mt-2"
                        icon
                        small
                        :disabled="pendingUpload.uploading"
                        @click="remove(pendingUpload)"
                      >
                        <v-icon>mdi-close</v-icon>
                      </v-btn>
                    </v-list-item-action>
                  </v-col>
                </v-row>
                <v-row>
                  <v-col>
                    <v-row>
                      <v-col>
                        <v-file-input
                          v-model="pendingUpload.mediaList"
                          label="Media Files"
                          multiple
                          :rules="[val => (val || '').length > 0 || 'Media Files are required']"
                          :accept="filterFileUpload(pendingUpload.type)"
                        />
                      </v-col>
                      <v-col>
                        <v-file-input
                          v-model="pendingUpload.annotationFile"
                          label="Annotation File"
                          hint="Optional"
                          :accept="filterFileUpload('annotation')"
                        />
                      </v-col>
                      <v-col>
                        <v-file-input
                          v-model="pendingUpload.meta"
                          label="Meta File"
                          hint="Optional"
                          :accept="filterFileUpload('meta')"
                        />
                      </v-col>
                    </v-row>
                    <v-col
                      cols="2"
                    >
                      <v-select
                        v-model="pendingUpload.fps"
                        :items="[1, 5, 10, 15, 24, 25, 30, 50, 60]"
                        :disabled="pendingUpload.uploading"
                        type="number"
                        required
                        label="FPS"
                        hint="annotation fps"
                        persistent-hint
                      />
                    </v-col>
                  </v-col>
                </v-row>
                <v-list-item-subtitle>
                  {{ computeUploadProgress(pendingUpload) }}
                </v-list-item-subtitle>
              </v-card>
            </v-list-item-content>
            <v-progress-linear
              :active="pendingUpload.uploading"
              :indeterminate="true"
              absolute
              bottom
            />
          </v-list-item>
        </v-list>
      </template>
    </girder-upload>
    <v-card
      class="pa-6"
      color="default"
    >
      <import-button
        name="Add Image Sequence"
        icon="mdi-folder-open"
        open-type="image-sequence"
        @open="openImport($event)"
        @multi-cam="openMultiCamDialog"
      />
      <import-button
        name="Add Video"
        icon="mdi-file-video"
        open-type="video"
        @open="openImport($event)"
        @multi-cam="openMultiCamDialog"
      />
    </v-card>
  </div>
</template>

<style lang="scss" scoped>
.upload {
  min-height: 50px;
  display: flex;
  flex-direction: column;

  .pending-upload-form {
    max-height: 65%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;

    .pending-uploads {
      overflow-y: auto;
    }
  }

  .dropzone-container {
    flex: 1;
    height: 1px;
  }
}
</style>

<style lang="scss">
.upload {
  .upload-name {
    .v-input__slot {
      padding-left: 0 !important;
    }
  }
}

.v-progress-linear--absolute {
  margin: 0;
}
</style>
