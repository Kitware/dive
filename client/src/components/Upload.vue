<script>
import Dropzone from '@girder/components/src/components/Presentation/Dropzone.vue';
import { fileUploader, sizeFormatter } from '@girder/components/src/utils/mixins';
import { ImageSequenceType, VideoType } from '@/constants';
import { makeViameFolder, validateUploadGroup, postProcess } from '@/lib/api/viame.service';
import { getResponseError } from '@/lib/utils';

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
        await this.addPendingUpload(name, files);
      } catch (err) {
        this.preUploadErrorMessage = err;
      }
    },
    async onFileChange(files) {
      if (files.length === 0) return;
      const name = files.length === 1 ? files[0].name : '';
      this.preUploadErrorMessage = null;
      try {
        await this.addPendingUpload(name, files);
      } catch (err) {
        this.preUploadErrorMessage = err;
      }
    },
    async addPendingUpload(name, allFiles) {
      const resp = await validateUploadGroup(allFiles.map((f) => f.name));
      if (!resp.ok) {
        throw new Error(resp.message);
      }
      const fps = this.defaultFPS;
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
    },
    async uploadPending(pendingUpload, uploaded) {
      const { name, files, createSubFolders } = pendingUpload;
      const fps = parseInt(pendingUpload.fps, 10);

      // eslint-disable-next-line no-param-reassign
      pendingUpload.uploading = true;

      let folder = this.location;
      if (!pendingUpload.createSubFolders) {
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
