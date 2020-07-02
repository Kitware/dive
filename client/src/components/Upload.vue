<script>
import Dropzone from '@girder/components/src/components/Presentation/Dropzone.vue';
import {
  fileUploader,
  sizeFormatter,
} from '@girder/components/src/utils/mixins';
import {
  ImageSequenceType,
  VideoType,
} from '@/constants';
import { makeViameFolder } from '@/lib/api/viame.service';
import { mapGetters } from 'vuex';
import { getResponseError } from '@/lib/utils';

function prepareFiles(files, videoRegEx, imageRegEx) {
  console.log(files, videoRegEx, imageRegEx);
  const videoFilter = (file) => videoRegEx.test(file.name);
  const csvFilter = (file) => /\.csv$/i.test(file.name);
  const imageFilter = (file) => imageRegEx.test(file.name);

  const videoFiles = files.filter(videoFilter);
  const imageFiles = files.filter(imageFilter);
  const csvFiles = files.filter(csvFilter);

  if (videoFiles.length > 0 && imageFiles.length > 0) {
    throw new Error('Do not upload images and videos in the same batch.');
  } else if (csvFiles.length > 1) {
    throw new Error('Can only upload a single CSV Annotation per import');
  } else if (videoFiles.length > 1 && csvFiles.length > 0) {
    throw new Error('Annotation upload is not supported when multiple videos are uploaded');
  } else if (videoFiles.length === 0 && imageFiles.length === 0 && csvFiles.length > 0) {
    throw new Error('Cannot upload annotations without media');
  } else if (videoFiles.length) {
    return {
      type: VideoType,
      media: videoFiles,
      csv: csvFiles,
    };
  } else if (imageFiles.length) {
    return {
      type: ImageSequenceType,
      media: imageFiles,
      csv: csvFiles,
    };
  }
  throw new Error('No supported data types found.  Please choose video or image frames.');
}

function entryToFile(entry) {
  return new Promise((resolve) => {
    entry.file((file) => {
      resolve(file);
    });
  });
}

async function readEntriesPromise(directoryReader) {
  try {
    return await new Promise((resolve, reject) => {
      directoryReader.readEntries(resolve, reject);
    });
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function readDirectoryEntries(entry) {
  const entries = [];
  const reader = entry.createReader();
  let readEntries = await readEntriesPromise(reader);
  while (readEntries.length > 0) {
    entries.push(...readEntries);
    // eslint-disable-next-line no-await-in-loop
    readEntries = await readEntriesPromise(reader);
  }
  return entries;
}

async function readFilesFromDrop(e) {
  const item = e.dataTransfer.items[0];
  const firstEntry = item.webkitGetAsEntry();
  if (!firstEntry.isDirectory) {
    return [
      firstEntry.name,
      Array.from(e.dataTransfer.items)
        .filter((_item) => _item.webkitGetAsEntry().isFile)
        .map((_item) => _item.getAsFile()),
    ];
  }
  const entries = await readDirectoryEntries(firstEntry);
  return [
    firstEntry.name,
    await Promise.all(entries.filter((entry) => entry.isFile).map(entryToFile)),
  ];
}

export default {
  name: 'Upload',
  components: { Dropzone },
  mixins: [fileUploader, sizeFormatter],
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
    defaultFPS: '10', // requires string for the input item
    ImageSequenceType,
  }),
  computed: {
    ...mapGetters('Filetypes', ['getVidRegEx', 'getImgRegEx']),
    uploadEnabled() {
      return this.location && this.location._modelType === 'folder';
    },
  },
  methods: {
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
        return `${this.filesNotUploaded(pendingUpload)} images`;
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
    async dropped(e) {
      e.preventDefault();
      const [name, files] = await readFilesFromDrop(e);
      if (files.length === 0) return;
      this.preUploadErrorMessage = null;
      try {
        this.addPendingUpload(name, files, this.filetypes);
      } catch (err) {
        this.preUploadErrorMessage = err;
      }
    },
    onFileChange(files) {
      if (files.length === 0) return;
      const name = files.length === 1 ? files[0].name : '';
      this.preUploadErrorMessage = null;
      try {
        this.addPendingUpload(name, files, this.filetypes);
      } catch (err) {
        this.preUploadErrorMessage = err;
      }
    },
    addPendingUpload(name, allFiles) {
      const { type, media, csv } = prepareFiles(allFiles, this.getVidRegEx, this.getImgRegEx);

      const files = media.concat(csv);
      const defaultFilename = files[0].name;
      // mapping needs to be done for the mixin upload functions
      const internalFiles = files.map((file) => ({
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
      // decide on the default createSubfoleders based on content uploaded
      let createSubFolders = false;
      if (type === 'video' && media.length > 1) {
        createSubFolders = true;
      }
      this.pendingUploads.push({
        createSubFolders,
        name:
          internalFiles.length > 1
            ? defaultFilename.replace(/\..*/, '')
            : defaultFilename,
        files: internalFiles,
        type,
        fps: this.defaultFPS,
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

      let success = true;
      // This is in a while loop to act like a Queue with it adding new items during upload
      while (this.pendingUploads.length > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.uploadPending(this.pendingUploads[0], uploaded);
        } catch (err) {
          success = false;
          // eslint-disable-next-line no-console
          console.error(err);
          break;
        }
      }
      this.$emit('update:uploading', false);
      if (success) {
        this.$emit('uploaded', uploaded);
      }
    },
    async uploadPending(pendingUpload, uploaded) {
      const { name, files, createSubFolders } = pendingUpload;
      const fps = parseInt(pendingUpload.fps, 10);

      const videoFilesRegEx = new RegExp(`${this.filetypes.video.join('$|')}$`, 'i');

      // eslint-disable-next-line no-param-reassign
      pendingUpload.uploading = true;

      let folder = this.location;
      if (!pendingUpload.createSubFolders) {
        folder = await this.createUploadFolder(name, createSubFolders, fps, pendingUpload.type);
        if (folder) {
          await this.uploadFiles(pendingUpload.name, folder, files, createSubFolders, uploaded);
          this.remove(pendingUpload);
        }
      } else {
        while (files.length > 0) {
          // take the file name and convert it to a folder name;
          const subfile = files.splice(0, 1);
          const subname = subfile[0].file.name.replace(/\..*/, '');
          // Only video subfolders should be used typically
          const subtype = videoFilesRegEx.test(subfile[0].file.name) ? 'video' : 'unknown';
          // eslint-disable-next-line no-await-in-loop
          folder = await (this.createUploadFolder(subname, createSubFolders, fps, subtype));
          if (folder) {
            // eslint-disable-next-line no-await-in-loop
            await this.uploadFiles(subname, folder, subfile, createSubFolders, uploaded);
          }
        }
        this.remove(pendingUpload);
      }
    },
    async createUploadFolder(name, createSubFolders, fps, type) {
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
    async uploadFiles(name, folder, files, createSubFolders, uploaded) {
      // function called after mixins upload finishes
      const postUpload = (data) => {
        uploaded.push({
          folder,
          results: data.results,
        });
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
};
</script>

<template>
  <div class="upload">
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
      <v-list class="py-0 pending-uploads">
        <v-list-item
          v-for="(pendingUpload, i) of pendingUploads"
          :key="i"
        >
          <v-list-item-content>
            <v-row>
              <v-col cols="auto">
                <v-checkbox
                  :input-value="pendingUpload.createSubFolders"
                  label="Create Subfolders"
                  disabled
                  hint="Enabled when many videos are being uploaded"
                  persistent-hint
                  class="pl-2"
                />
              </v-col>
              <v-col>
                <v-text-field
                  v-model="pendingUpload.name"
                  class="upload-name"
                  :rules="[
                    val => (val || '').length > 0 || 'This field is required'
                  ]"
                  required
                  :label="getFilenameInputStateLabel(pendingUpload)"
                  :disabled="getFilenameInputStateDisabled(pendingUpload)"
                  :hint="getFilenameInputStateHint(pendingUpload)"
                  persistent-hint
                />
              </v-col>
              <v-col
                v-if="pendingUpload.type === ImageSequenceType"
                cols="2"
              >
                <v-text-field
                  v-model="pendingUpload.fps"
                  type="number"
                  :rules="[
                    val => (val || '').length > 0 || 'This field is required'
                  ]"
                  required
                  label="FPS"
                  hide-details
                  :disabled="pendingUpload.uploading"
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
            <v-list-item-subtitle>
              {{ computeUploadProgress(pendingUpload) }}
            </v-list-item-subtitle>
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
    <div class="dropzone-container">
      <Dropzone
        class="dropzone"
        multiple
        message="Drag files or directory here"
        @drop.native="dropped"
        @change="onFileChange"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.upload {
  min-height: 350px;
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
