<script>
import Vue from 'vue';
import { mixins } from '@girder/components/src';

import {
  ImageSequenceType, VideoType, DefaultVideoFPS, inputAnnotationFileTypes,
  websafeVideoTypes, otherVideoTypes, websafeImageTypes, otherImageTypes,
} from 'dive-common/constants';

import ImportButton from 'dive-common/components/ImportButton.vue';
import ImportMultiCamDialog from 'dive-common/components/ImportMultiCamDialog.vue';
import {
  makeViameFolder, validateUploadGroup, postProcess, openFromDisk,
} from '../api/viame.service';
import { getResponseError } from '../utils';

export default Vue.extend({
  name: 'Upload',
  components: { ImportButton, ImportMultiCamDialog },
  mixins: [mixins.fileUploader, mixins.sizeFormatter],
  inject: ['girderRest'],
  props: {
    location: {
      type: Object,
      required: true,
    },
  },
  data: () => ({
    preUploadErrorMessage: null,
    pendingUploads: [],
    ImageSequenceType,
    stereo: false,
    multiCamOpenType: 'image-sequence',
    importMultiCamDialog: false,
  }),
  computed: {
    uploadEnabled() {
      return this.location && this.location._modelType === 'folder';
    },
  },
  methods: {
    async openImport(dstype) {
      const ret = await openFromDisk(dstype);
      if (!ret.canceled) {
        const processed = this.processImport(ret);
        if (processed.fullList.length === 0) return;
        const name = processed.fullList.length === 1 ? processed.fullList[0].name : '';
        this.preUploadErrorMessage = null;
        try {
          await this.addPendingUpload(
            name, processed.fullList, processed.meta, processed.annotationFile, processed.mediaList,
          );
        } catch (err) {
          this.preUploadErrorMessage = err;
        }
      }
    },
    processImport(files) {
      //Check for auto files for meta and annotations
      const output = {
        annotationFile: null,
        metaFile: null,
        mediaList: null,
        fullList: null,
      };
      const jsonFiles = [];
      const csvFiles = [];
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
      if (jsonFiles.length === 1 && csvFiles.length === 0 && output.metaFile !== '') {
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
      output.fullList = [].concat(output.mediaList);
      if (output.annotationFile) {
        output.fullList.push(output.annotationFile);
      }
      if (output.metaFile) {
        output.fullList.push(output.metaFile);
      }
      return output;
    },
    /**
     * @param {{ stereo: string, openType: 'image-sequence' | 'video' }} args
     */
    openMultiCamDialog(args) {
      this.stereo = args.stereo;
      this.multiCamOpenType = args.openType;
      this.importMultiCamDialog = true;
    },
    filterFileUpload(type) {
      if (type === 'meta') {
        return '.json';
      } if (type === 'annotation') {
        return inputAnnotationFileTypes.map((item) => `.${item}`).join(',');
      } if (type === 'video') {
        return websafeVideoTypes.concat(otherVideoTypes);
      }
      return websafeImageTypes.concat(otherImageTypes);
    },
    multiCamImportCheck(args) {
      return {
        jsonMeta: {
          originalImageFiles: args,
        },
        globPattern: '',
        mediaConvertList: [],

      };
    },
    multiCamImport(args) {
      console.log(args);
    },
    // Filter to show how many images are left to upload
    filesNotUploaded(item) {
      return item.files.filter(
        (file) => file.status !== 'done' && file.status !== 'error',
      ).length;
    },
    /**
     * @param {{ type: string, size: number, files: Array, uploading: boolean }} pendingUpload
     * @returns {number} # of images or size of file depending on type and state
     *  size, and list of files to upload.
     */
    computeUploadProgress(pendingUpload) {
      // use methods and properties from mixins
      const { formatSize, totalProgress, totalSize } = this;
      if (pendingUpload.files.length === 1 && !pendingUpload.uploading) {
        return this.formatSize(pendingUpload.files[0].progress.size);
      } if (pendingUpload.type === ImageSequenceType) {
        return `${this.filesNotUploaded(pendingUpload)} files`;
      } if (pendingUpload.type === VideoType && !pendingUpload.uploading) {
        return `${this.filesNotUploaded(pendingUpload)} videos`;
      } if (pendingUpload.type === VideoType && pendingUpload.uploading) {
        // For videos we display the total progress when uploading because
        // single videos can be large
        return `${formatSize(totalProgress)} of ${formatSize(totalSize)}`;
      }
      throw new Error(`could not determine adequate formatting for ${pendingUpload}`);
    },
    getFilenameInputStateLabel(pendingUpload) {
      const plural = pendingUpload.createSubFolders
        ? 's'
        : '';
      return `Folder Name${plural}`;
    },
    getFilenameInputStateDisabled(pendingUpload) {
      return (pendingUpload.uploading || pendingUpload.createSubFolders);
    },
    getFilenameInputStateHint(pendingUpload) {
      return (pendingUpload.createSubFolders ? 'default folder names are used when "Create Subfolders" is selected' : '');
    },
    async addPendingUpload(name, allFiles, meta, annotationFile, mediaList) {
      console.log(name);
      console.log(allFiles);
      console.log(meta);
      const resp = await validateUploadGroup(allFiles.map((f) => f.name));
      if (!resp.ok) {
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
      this.pendingUploads.push({
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
    },
    abort(pendingUpload) {
      if (this.errorMessage) {
        this.remove(pendingUpload);
        this.errorMessage = null;
      } else {
        this.preUploadErrorMessage = null;
      }
    },
    remove(pendingUpload) {
      const index = this.pendingUploads.indexOf(pendingUpload);
      this.pendingUploads.splice(index, 1);
    },
    async upload() {
      if (this.location._modelType !== 'folder') {
        return;
      }
      if (!this.$refs.form.validate()) {
        return;
      }
      const uploaded = [];
      this.$emit('update:uploading', true);

      // This is in a while loop to act like a Queue with it adding new items during upload
      while (this.pendingUploads.length > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.uploadPending(this.pendingUploads[0], uploaded);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(err);
          break;
        }
      }
      this.$emit('update:uploading', false);
    },
    async uploadPending(pendingUpload, uploaded) {
      const { name, files, createSubFolders } = pendingUpload;
      const fps = parseInt(pendingUpload.fps, DefaultVideoFPS);

      // eslint-disable-next-line no-param-reassign
      pendingUpload.uploading = true;

      let folder = this.location;
      if (!createSubFolders) {
        folder = await this.createUploadFolder(name, fps, pendingUpload.type);
        if (folder) {
          await this.uploadFiles(pendingUpload.name, folder, files, uploaded);
          this.remove(pendingUpload);
        }
      } else {
        while (files.length > 0) {
          // take the file name and convert it to a folder name;
          const subfile = files.splice(0, 1);
          const subname = subfile[0].file.name.replace(/\..*/, '');
          // All sub-folders for a pendingUpload must be the same type
          const subtype = pendingUpload.type;
          // eslint-disable-next-line no-await-in-loop
          folder = await (this.createUploadFolder(subname, fps, subtype));
          if (folder) {
            // eslint-disable-next-line no-await-in-loop
            await this.uploadFiles(subname, folder, subfile, uploaded);
          }
        }
        this.remove(pendingUpload);
      }
    },
    async createUploadFolder(name, fps, type) {
      try {
        const { data } = await makeViameFolder({
          folderId: this.location._id,
          name,
          type,
          fps,
        });
        return data;
      } catch (error) {
        this.errorMessage = getResponseError(error);
        throw error;
      }
    },
    async uploadFiles(name, folder, files, uploaded) {
      // function called after mixins upload finishes
      const postUpload = async (data) => {
        uploaded.push({
          folder,
          results: data.results,
        });
        await postProcess(folder._id);
      };
      // Sets the files used by the fileUploader mixin
      this.setFiles(files);
      // Upload Mixin function to start uploading
      await this.start({
        dest: folder,
        postUpload,
      });
    },
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
    <v-form
      v-if="pendingUploads.length"
      ref="form"
      class="pending-upload-form"
      @submit.prevent="upload"
    >
      <v-toolbar
        flat
        color="primary"
        dark
        dense
      >
        <v-toolbar-title>Pending upload</v-toolbar-title>
        <v-spacer />
        <v-btn
          type="submit"
          text
          :disabled="!uploadEnabled"
        >
          Start Upload
        </v-btn>
      </v-toolbar>
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
    </v-form>
    <!-- errorMessage is provided by the fileUploader mixin -->
    <div v-if="errorMessage || preUploadErrorMessage">
      <v-alert
        :value="true"
        dark="dark"
        tile="tile"
        type="error"
        class="mb-0"
      >
        {{ errorMessage || preUploadErrorMessage }}
        <v-btn
          v-if="preUploadErrorMessage || pendingUploads[0].uploading"
          class="ml-3"
          dark="dark"
          small="small"
          outlined="outlined"
          @click="abort(pendingUploads[0])"
        >
          Abort
        </v-btn>
      </v-alert>
    </div>
    <v-card
      class="pa-6"
      color="default"
    >
      <import-button
        name="Open Image Sequence"
        icon="mdi-folder-open"
        open-type="image-sequence"
        @open="openImport($event)"
        @multi-cam="openMultiCamDialog"
      />
      <import-button
        name="Open Video"
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
