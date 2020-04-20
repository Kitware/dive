<script>
import Dropzone from '@girder/components/src/components/Presentation/Dropzone.vue';
import {
  fileUploader,
  sizeFormatter,
} from '@girder/components/src/utils/mixins';

// Supported File Types
const videoFileTypes = ['.mp4', '.avi', '.mov'];
const imageFileTypes = ['.jpg', '.jpeg', '.png', '.bmp'];
// Utility for commonly used regular expressions
const videoFilesRegEx = new RegExp(videoFileTypes.join('$|'), 'i');
const imageFilesRegEx = new RegExp(imageFileTypes.join('$|'), 'i');
function prepareFiles(files) {
  const videoFilter = (file) => videoFilesRegEx.test(file.name);
  const csvFilter = (file) => /\.csv$/i.test(file.name);
  const imageFilter = (file) => imageFilesRegEx.test(file.name);

  if (files.find(videoFilter)) {
    return [
      'video',
      files.filter((file) => videoFilter(file) || csvFilter(file)),
    ];
  }
  return [
    'image-sequence',
    files.filter((file) => imageFilter(file) || csvFilter(file)),
  ];
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
    pendingUploads: [],
    defaultFPS: '10', // requires string for the input item
    uploadOpts: [{
      name: 'Folder', value: 'folder', description: 'Upload all items to a single folder',
    },
    {
      name: 'Current', value: 'current', description: 'Upload all items to current folder',
    },
    {
      name: 'SubFolders', value: 'subfolder', description: 'Upload each item to its own folder',
    }],
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
      } if (pendingUpload.type === 'image-sequence') {
        return `${this.filesNotUploaded(pendingUpload)} images`;
      } if (pendingUpload.type === 'video' && !pendingUpload.uploading) {
        return `${this.filesNotUploaded(pendingUpload)} videos`;
      } if (pendingUpload.type === 'video' && pendingUpload.uploading) {
        // For videos we display the total progress when uploading because
        // single videos can be large
        return `${formatSize(totalProgress)} of ${formatSize(totalSize)}`;
      }
      throw new Error(`could not determine adequate formatting for ${pendingUpload}`);
    },
    getFilenameInputStateLabel(pendingUpload) {
      const type = pendingUpload.uploadLocation !== 'current' ? 'Folder' : 'File';
      const plural = pendingUpload.files.length > 1 && pendingUpload.uploadLocation !== 'folder'
        ? 's'
        : '';
      return `${type} Name${plural}`;
    },
    getFilenameInputStateDisabled(pendingUpload) {
      return (
        pendingUpload.uploading
        || pendingUpload.uploadLocation === 'subfolder'
        || (pendingUpload.uploadLocation === 'current' && pendingUpload.files.length > 1)
      );
    },
    getFilenameInputStateHint(pendingUpload) {
      return ((pendingUpload.uploadLocation === 'current' && pendingUpload.files.length > 1) || pendingUpload.uploadLocation === 'subfolder')
        ? 'default filenames are used'
        : '';
    },
    async dropped(e) {
      e.preventDefault();
      const [name, files] = await readFilesFromDrop(e);
      this.addPendingUpload(name, files);
    },
    onFileChange(files) {
      const name = files.length === 1 ? files[0].name : '';
      this.addPendingUpload(name, files);
    },
    addPendingUpload(name, allFiles) {
      const [type, files] = prepareFiles(allFiles);
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
      // decide on the default uploadLocation based on content uploaded
      let uploadLocation = internalFiles.length === 1 ? 'current' : 'folder';

      let imageFiles = 0;
      let videoFiles = 0;
      for (let i = 0; i < internalFiles.length; i += 1) {
        if (imageFilesRegEx.test(internalFiles[i].file.name)) {
          imageFiles += 1;
        }
        if (videoFilesRegEx.test(internalFiles[i].file.name)) {
          videoFiles += 1;
        }
      }

      if (imageFiles > 0 && videoFiles > 0) {
        uploadLocation = 'folder';
      } else if (imageFiles > 0 && internalFiles.length > 1) {
        uploadLocation = 'folder';
      } else if (imageFiles > 0) {
        uploadLocation = 'current';
      } else if (videoFiles > 0) {
        uploadLocation = 'subfolder';
      }

      this.pendingUploads.push({
        uploadLocation,
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
        // eslint-disable-next-line no-await-in-loop
        await this.uploadPending(this.pendingUploads[0], uploaded);
      }
      this.$emit('update:uploading', false);
      this.$emit('uploaded', uploaded);
    },
    async uploadPending(pendingUpload, uploaded) {
      const { name, files, uploadLocation } = pendingUpload;
      const fps = parseInt(pendingUpload.fps, 10);
      // eslint-disable-next-line no-param-reassign
      pendingUpload.uploading = true;

      let folder = this.location;
      if (pendingUpload.uploadLocation !== 'subfolder') {
        folder = await this.createUploadFolder(name, uploadLocation, fps, pendingUpload.type);
        if (folder) {
          await this.uploadFiles(pendingUpload.name, folder, files, uploadLocation, uploaded);
          this.remove(pendingUpload);
        }
      } else if (pendingUpload.uploadLocation === 'subfolder') {
        while (files.length > 0) {
          // take the file name and convert it to a folder name;
          const subfile = files.splice(0, 1);
          const subname = subfile[0].file.name.replace(/\..*/, '');
          // Only video subfolders should be used typically
          const subtype = videoFilesRegEx.test(subfile[0].file.name) ? 'video' : 'unknown';
          // eslint-disable-next-line no-await-in-loop
          folder = await (this.createUploadFolder(subname, uploadLocation, fps, subtype));
          if (folder) {
            // eslint-disable-next-line no-await-in-loop
            await this.uploadFiles(subname, folder, subfile, uploadLocation, uploaded);
          }
        }
        this.remove(pendingUpload);
      }
    },
    async createUploadFolder(name, uploadLocation, fps, type) {
      let folder = this.location;
      if (uploadLocation !== 'current') {
        try {
          ({ data: folder } = await this.girderRest.post(
            '/folder',
            `metadata=${JSON.stringify({
              viame: true,
              fps,
              type,
            })}`,
            {
              params: {
                parentId: this.location._id,
                name,
              },
            },
          ));
        } catch (error) {
          if (
            error.response
            && error.response.data
            && error.response.data.message
          ) {
            this.errorMessage = error.response.data.message;
          } else {
            this.errorMessage = error;
          }
          // Set an empty object for the folder destructuring
          folder = null;
        }
      }
      return folder;
    },
    async uploadFiles(name, folder, files, uploadLocation, uploaded) {
    // If a single file's chosen filename is different from the uploaded file
      if (
        uploadLocation === 'current'
        && files.length === 1
        && files[0].file.name !== name
      ) {
      // Mixin parameters for uploading to overwrite file name
      // eslint-disable-next-line no-param-reassign
        files[0].uploadClsParams = { name };
      }
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
              <v-col cols="3">
                <v-select
                  v-model="pendingUpload.uploadLocation"
                  :items="uploadOpts"
                  item-text="name"
                  item-value="value"
                  label="Upload Location"
                  class="pl-2"
                >
                  <template #item="{item}">
                    {{ item.name }}
                    <v-tooltip
                      right
                      color="primary"
                    >
                      <template v-slot:activator="{ on }">
                        <v-icon
                          class="pl-2"
                          v-on="on"
                        >
                          mdi-help-circle
                        </v-icon>
                      </template>
                      <span>{{ item.description }}</span>
                    </v-tooltip>
                  </template>
                </v-select>
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
                v-if="pendingUpload.uploadLocation"
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
              <!-- errorMessage is provided by the fileUploader mixin -->
              <div v-if="errorMessage">
                <v-alert
                  :value="true"
                  dark="dark"
                  tile="tile"
                  type="error"
                >
                  {{ errorMessage }}
                  <v-btn
                    v-if="!uploading"
                    class="ml-3"
                    dark="dark"
                    small="small"
                    outlined="outlined"
                    @click="remove(pendingUpload)"
                  >
                    Abort
                  </v-btn>
                </v-alert>
              </div>
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
