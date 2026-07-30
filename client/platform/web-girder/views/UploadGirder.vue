<script>
import Vue from 'vue';
import { mixins } from '@girder/components/src';
import { clone } from 'lodash';
import { getResponseError } from 'vue-media-annotator/utils';
import {
  fileSuffixRegex,
} from 'platform/web-girder/constants';

import {
  makeViameFolder, postProcess, uploadMetadataFileItem, setDatasetMetadataFile,
} from 'platform/web-girder/api';
import { GirderUploadManager } from 'platform/web-girder/utils';

export default Vue.extend({
  name: 'GirderUpload',
  mixins: [mixins.fileUploader, mixins.sizeFormatter, mixins.progressReporter],
  inject: ['girderRest'],
  props: {
    location: {
      type: Object,
      required: true,
    },
    pendingUploads: {
      type: Array,
      required: true,
    },
    preUploadErrorMessage: {
      type: String,
      default: null,
    },
  },
  computed: {
    uploadEnabled() {
      return this.location && this.location._modelType === 'folder';
    },
  },
  methods: {
    abort(pendingUpload) {
      if (this.errorMessage) {
        this.errorMessage = null;
      }
      // eslint-disable-next-line no-param-reassign
      pendingUpload.uploading = false;
      this.remove(pendingUpload);
      this.$emit('abort');
    },
    remove(pendingUpload) {
      const index = this.pendingUploads.indexOf(pendingUpload);
      this.$emit('remove-upload', index);
    },
    async upload() {
      if (this.location._modelType !== 'folder') {
        return;
      }
      const uploaded = [];
      this.$emit('update:uploading', true);

      // This is in a while loop to act like a Queue with it adding new items during upload
      let error = '';
      const pendingUplodsCopy = clone(this.pendingUploads); // SHALLOW COPY
      for (let i = 0; i < pendingUplodsCopy.length; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.uploadPending(pendingUplodsCopy[i], uploaded);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(err);
          error = err;
          break;
        }
      }
      if (!error) {
        this.$emit('update:uploading', false);
      }
    },
    convertFileToInternal(file) {
      if (file === null) {
        return null;
      }
      return {
        file,
        status: 'pending',
        progress: {
          indeterminate: false,
          current: 0,
          size: file.size,
        },
        upload: null,
        result: null,
      };
    },
    async uploadPending(pendingUpload, uploaded) {
      const {
        name, createSubFolders, meta, annotationFile, mediaList, metadataFile,
      } = pendingUpload;
      //Combine the files for uploading. The optional metadata file is uploaded
      //separately (as a marked item) so postprocess does not classify it.
      let files = mediaList.map((item) => this.convertFileToInternal(item));
      files.push(this.convertFileToInternal(meta));
      files.push(this.convertFileToInternal(annotationFile));
      files = files.filter((item) => item !== null);
      // eslint-disable-next-line no-param-reassign
      pendingUpload.files = files;
      const fps = parseInt(pendingUpload.fps, 10);

      // eslint-disable-next-line no-param-reassign
      pendingUpload.uploading = true;
      const skipTranscoding = !!pendingUpload.skipTranscoding;

      let folder = this.location;
      if (!createSubFolders) {
        folder = await this.createUploadFolder(name, fps, pendingUpload.type);
        if (folder) {
          await this.uploadFiles(pendingUpload.name, folder, files, uploaded, skipTranscoding);
          if (metadataFile) {
            const itemId = await uploadMetadataFileItem(folder._id, metadataFile);
            await setDatasetMetadataFile(folder._id, itemId);
          }
          this.remove(pendingUpload);
        }
      } else {
        while (files.length > 0) {
          // take the file name and convert it to a folder name;
          const subfile = files.splice(0, 1);
          const subname = subfile[0].file.name.replace(fileSuffixRegex, '');
          // All sub-folders for a pendingUpload must be the same type
          const subtype = pendingUpload.type;
          // eslint-disable-next-line no-await-in-loop
          folder = await (this.createUploadFolder(subname, fps, subtype));
          if (folder) {
            // eslint-disable-next-line no-await-in-loop
            await this.uploadFiles(subname, folder, subfile, uploaded, skipTranscoding);
          }
        }
        this.remove(pendingUpload);
      }
    },
    async createUploadFolder(name, fps, type, parentFolderId = null) {
      try {
        const { data } = await makeViameFolder({
          folderId: parentFolderId || this.location._id,
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
    async uploadFiles(name, folder, files, uploaded, skipTranscoding = false) {
      let jobIds = [];
      // function called after mixins upload finishes
      const postUpload = async (data) => {
        uploaded.push({
          folder,
          results: data.results,
        });
        try {
          const { data: postprocessResult } = await postProcess(folder._id, false, skipTranscoding);
          jobIds = postprocessResult.job_ids ?? [];
        } catch (err) {
          this.$emit('error', { err, name });
          throw err;
        }
      };
      // Sets the files used by the fileUploader mixin
      this.setFiles(files);
      // Upload Mixin function to start uploading
      await this.start({
        dest: folder,
        postUpload,
        uploadCls: GirderUploadManager,
      });
      return { folder, jobIds };
    },
    /**
     * Upload a single camera dataset folder (used by multicam import).
     */
    async uploadCameraDataset({
      name, fps, type, mediaList, meta = null, annotationFile = null, skipTranscoding = true,
      parentFolderId = null,
    }) {
      let files = mediaList.map((item) => this.convertFileToInternal(item));
      files.push(this.convertFileToInternal(meta));
      files.push(this.convertFileToInternal(annotationFile));
      files = files.filter((item) => item !== null);
      const folder = await this.createUploadFolder(name, parseInt(fps, 10), type, parentFolderId);
      if (!folder) {
        throw new Error(`Failed to create folder for camera ${name}`);
      }
      const { folder: uploadedFolder, jobIds } = await this.uploadFiles(name, folder, files, [], skipTranscoding);
      return { folder: uploadedFolder, jobIds };
    },
  },
});
</script>

<template>
  <div>
    <!-- errorMessage is provided by the fileUploader mixin -->
    <div v-if="errorMessage || preUploadErrorMessage">
      <v-alert
        :value="true"
        dark="dark"
        type="error"
        class="my-3"
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
    <slot v-bind="{ upload }" />
  </div>
</template>
