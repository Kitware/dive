<script>
import Vue from 'vue';
import { mixins } from '@girder/components/src';

import {
  DefaultVideoFPS,
} from 'dive-common/constants';

import {
  makeViameFolder, postProcess,
} from '../api/viame.service';
import { getResponseError } from '../utils';

export default Vue.extend({
  name: 'GirderUpload',
  mixins: [mixins.fileUploader, mixins.sizeFormatter],
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
  data: () => ({
  }),
  computed: {
    uploadEnabled() {
      return this.location && this.location._modelType === 'folder';
    },
  },
  methods: {
    abort(pendingUpload) {
      if (this.errorMessage) {
        this.remove(pendingUpload);
        this.errorMessage = null;
      }
      this.$emit('update:uploading', false);
    },
    remove(pendingUpload) {
      const index = this.pendingUploads.indexOf(pendingUpload);
      this.$emit('remove-upload', index);
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
      let error = '';
      while (this.pendingUploads.length > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.uploadPending(this.pendingUploads[0], uploaded);
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
        name, createSubFolders, meta, annotationFile, mediaList,
      } = pendingUpload;
      //Combine the files for uploading
      let files = mediaList.map((item) => this.convertFileToInternal(item));
      files.push(this.convertFileToInternal(meta));
      files.push(this.convertFileToInternal(annotationFile));
      files = files.filter((item) => item !== null);
      // eslint-disable-next-line no-param-reassign
      pendingUpload.files = files;
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
        //throw error;
        return error;
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
  <div>
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
      <slot name="upload-list" />
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
