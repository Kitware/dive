<script>
import { mapState } from "vuex";
import Dropzone from "@girder/components/src/components/Presentation/Dropzone.vue";
import {
  fileUploader,
  sizeFormatter
} from "@girder/components/src/utils/mixins";

export default {
  name: "Upload",
  components: { Dropzone },
  mixins: [fileUploader, sizeFormatter],
  inject: ["girderRest"],
  props: {
    location: {
      type: Object
    }
  },
  data: () => ({
    pendingUploads: [],
    defaultFPS: "10", // requires string for the input item
    createFolder: true
  }),
  computed: {
    uploadEnabled() {
      return this.location && this.location._modelType === "folder";
    },
    pipelineItems() {
      return [
        { text: "None", value: null },
        ...this.pipelines.map(pipeline => ({ text: pipeline, value: pipeline }))
      ];
    },
    ...mapState(["pipelines"])
  },
  methods: {
    // Filter to show how many images are left to upload
    filesNotUploaded(item) {
      return item.files.filter(
        item => item.status !== "done" && item.status !== "error"
      ).length;
    },
    // Takes the pending upload and returns the # of images or size of the file
    computeUploadProgress(pendingUpload) {
      // formatSize, totalProgress and totalSize are located in the fileUploader and sizeFormatter mixin
      if (pendingUpload.files.length === 1 && !pendingUpload.uploading) {
        return this.formatSize(pendingUpload.files[0].progress.size);
      } else if (pendingUpload.type == "image-sequence") {
        return `${this.filesNotUploaded(pendingUpload)} images`;
      } else if (pendingUpload.type == "video" && !pendingUpload.uploading) {
        return `${this.filesNotUploaded(pendingUpload)} videos`;
      } else if (pendingUpload.type === "video" && pendingUpload.uploading) {
        // For videos we display the total progress when uploading because single videos can be large
        return `${this.formatSize(this.totalProgress)} of ${this.formatSize(
          this.totalSize
        )}`;
      }
    },
    async dropped(e) {
      e.preventDefault();
      let [name, files] = await readFilesFromDrop(e);
      this.addPendingUpload(name, files);
    },
    onFileChange(files) {
      var name = files.length === 1 ? files[0].name : "";
      this.addPendingUpload(name, files);
    },
    addPendingUpload(name, allFiles) {
      var [type, files] = prepareFiles(allFiles);
      let defaultFilename = files[0].name;
      // mapping needs to be done for the mixin upload functions
      files = files.map(file => ({
        file,
        status: "pending",
        progress: {
          indeterminate: false,
          current: 0,
          size: file.size
        },
        upload: null,
        result: null
      }));
      this.pendingUploads.push({
        name: defaultFilename.replace(/\..*/, ""),
        files: files,
        type,
        fps: this.defaultFPS,
        pipeline: null,
        uploading: false
      });
    },
    remove(pendingUpload) {
      var index = this.pendingUploads.indexOf(pendingUpload);
      this.pendingUploads.splice(index, 1);
    },
    async upload() {
      if (this.location._modelType !== "folder") {
        return;
      }
      if (!this.$refs.form.validate()) {
        return;
      }
      var uploaded = [];
      this.$emit("update:uploading", true);

      // This is in a while loop to act like a Queue with it adding new items during upload
      while (this.pendingUploads.length > 0) {
        await this.uploadPending(this.pendingUploads[0], uploaded);
      }
      this.createFolder = true;
      this.$emit("update:uploading", false);
      console.log(uploaded);
      this.$emit("uploaded", uploaded);
    },
    async uploadPending(pendingUpload, uploaded) {
      var { name, files, fps } = pendingUpload;
      fps = parseInt(fps);
      pendingUpload.uploading = true;
      var { data: folder } = await this.girderRest
        .post(
          "/folder",
          `metadata=${JSON.stringify({
            viame: true,
            fps,
            type: pendingUpload.type
          })}`,
          {
            params: {
              parentId: this.location._id,
              name
            }
          }
        )
        .catch(error => {
          if (
            error.response &&
            error.response.data &&
            error.response.data.message
          ) {
            this.errorMessage = error.response.data.message;
          } else {
            this.errorMessage = error;
          }
          pendingUpload.uploading = false;
          // Return empty object for the folder destructuring
          return { data: null };
        });

      // function called after mixins upload finishes
      const postUpload = data => {
        uploaded.push({
          folder,
          results: data.results,
          pipeline: pendingUpload.pipeline
        });
      };

      // Sets the files used by the fileUploader mixin
      this.setFiles(files);

      // Only call if the folder post() is successful
      if (pendingUpload.uploading) {
        // Upload Mixin function to start uploading
        await this.start({
          dest: folder,
          postUpload: postUpload
        });
        this.remove(pendingUpload);
      }
    }
  }
};
async function readFilesFromDrop(e) {
  var item = e.dataTransfer.items[0];
  var firstEntry = item.webkitGetAsEntry();
  if (!firstEntry.isDirectory) {
    return [
      firstEntry.name,
      Array.from(e.dataTransfer.items)
        .filter(item => item.webkitGetAsEntry().isFile)
        .map(item => item.getAsFile())
    ];
  } else {
    let entries = await readDirectoryEntries(firstEntry);
    return [
      firstEntry.name,
      await Promise.all(entries.filter(entry => entry.isFile).map(entryToFile))
    ];
  }
}

async function readDirectoryEntries(entry) {
  let entries = [];
  let reader = entry.createReader();
  let readEntries = await readEntriesPromise(reader);
  while (readEntries.length > 0) {
    entries.push(...readEntries);
    readEntries = await readEntriesPromise(reader);
  }
  return entries;
}

async function readEntriesPromise(directoryReader) {
  try {
    return await new Promise((resolve, reject) => {
      directoryReader.readEntries(resolve, reject);
    });
  } catch (err) {
    console.error(err);
  }
}

function entryToFile(entry) {
  return new Promise(resolve => {
    entry.file(file => {
      resolve(file);
    });
  });
}

function prepareFiles(files) {
  var videoFilter = file => /\.mp4$|\.avi$|\.mov$/i.test(file.name);
  var csvFilter = file => /\.csv$/i.test(file.name);
  var imageFilter = file => /\.jpg$|\.jpeg$|\.png$|\.bmp$/i.test(file.name);

  if (files.find(videoFilter)) {
    return [
      "video",
      files.filter(file => videoFilter(file) || csvFilter(file))
    ];
  } else {
    return [
      "image-sequence",
      files.filter(file => imageFilter(file) || csvFilter(file))
    ];
  }
}
</script>

<template>
  <div class="upload">
    <v-form
      v-if="pendingUploads.length"
      ref="form"
      class="pending-upload-form"
      @submit.prevent="upload"
    >
      <v-toolbar flat color="primary" dark dense>
        <v-toolbar-title>Pending upload</v-toolbar-title>
        <v-spacer />
        <v-btn type="submit" text :disabled="!uploadEnabled">
          Start Upload
        </v-btn>
      </v-toolbar>
      <v-list class="py-0 pending-uploads">
        <v-list-item v-for="(pendingUpload, i) of pendingUploads" :key="i">
          <v-list-item-content>
            <v-row>
              <v-col>
                <v-text-field
                  class="upload-name"
                  v-model="pendingUpload.name"
                  :rules="[
                    val => (val || '').length > 0 || 'This field is required'
                  ]"
                  required
                  label="Name"
                  hide-details
                  :disabled="pendingUpload.uploading"
                ></v-text-field>
              </v-col>
              <v-col
                :cols="2"
                v-if="pendingUpload.type === 'image-sequence' && createFolder"
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
                ></v-text-field>
              </v-col>
            </v-row>
            <v-list-item-subtitle>
              {{ computeUploadProgress(pendingUpload) }}
              <!-- errorMessage is provided by the fileUploader mixin -->
              <div v-if="errorMessage">
                <v-alert :value="true" dark="dark" tile="tile" type="error">
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
          <v-list-item-action>
            <v-btn
              icon
              small
              @click="remove(pendingUpload)"
              :disabled="pendingUpload.uploading"
            >
              <v-icon>mdi-close</v-icon>
            </v-btn>
          </v-list-item-action>
          <v-progress-linear
            :active="pendingUpload.uploading"
            :indeterminate="true"
            absolute
            bottom
          ></v-progress-linear>
        </v-list-item>
        <v-list-item>
          <v-switch label="Create Folder" v-model="createFolder" />
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
