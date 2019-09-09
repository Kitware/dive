<script>
import Dropzone from "@girder/components/src/components/Presentation/Dropzone.vue";
import { Upload } from "@girder/components/src/utils";

export default {
  name: "Upload",
  components: { Dropzone },
  inject: ["girderRest"],
  props: {
    location: {
      type: Object
    }
  },
  data: () => ({
    pendingUploads: []
  }),
  computed: {
    uploadEnabled() {
      return this.location && this.location._modelType === "folder";
    }
  },
  methods: {
    onFileChange(files) {
      if (files.length >= 1) {
        var name = files.length === 1 ? files[0].name : "";
        this.pendingUploads.push({
          name,
          files,
          fps: null,
          uploading: false
        });
      }
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
      await Promise.all(
        this.pendingUploads.map(async pendingUpload => {
          var { name, files, fps } = pendingUpload;
          fps = parseInt(fps);
          pendingUpload.uploading = true;
          var { data: item } = await this.girderRest.post(
            "/item",
            `metadata=${JSON.stringify({
              viame: true,
              fps,
              type: files.length > 1 ? "image-sequence" : "video"
            })}`,
            {
              params: {
                folderId: this.location._id,
                name
              }
            }
          );
          await Promise.all(
            files.map(async file => {
              var uploader = new Upload(file, {
                $rest: this.girderRest,
                parent: item
              });
              var result = await uploader.start();
              // The logic for trigging transcoding below probably should belong to another place
              if (
                files.length === 1 &&
                ["avi", "mp4", "mov"].includes(result.exts[0])
              ) {
                this.girderRest.post(
                  `/viame/conversion?itemId=${result.itemId}`
                );
                this.$snackbar({
                  text: "Transcoding started",
                  timeout: 6000,
                  immediate: true,
                  button: "View",
                  callback: () => {
                    this.$router.push("/jobs");
                  }
                });
              }
            })
          );
          this.remove(pendingUpload);
        })
      );
      this.$emit("uploaded");
    }
  }
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
      <v-toolbar flat color="primary" dark dense>
        <v-toolbar-title>Pending upload</v-toolbar-title>
        <v-spacer />
        <v-btn type="submit" text :disabled="!uploadEnabled">
          Upload
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
                ></v-text-field>
              </v-col>
              <v-col :cols="3" v-if="pendingUpload.files.length > 1">
                <v-text-field
                  v-model="pendingUpload.fps"
                  type="number"
                  :rules="[
                    val => (val || '').length > 0 || 'This field is required'
                  ]"
                  required
                  label="FPS"
                  hide-details
                ></v-text-field>
              </v-col>
            </v-row>
            <v-list-item-subtitle v-if="pendingUpload.files.length > 1">
              {{ pendingUpload.files.length }} images
            </v-list-item-subtitle>
          </v-list-item-content>
          <v-list-item-action>
            <v-btn icon small @click="remove(pendingUpload)">
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
      </v-list>
    </v-form>
    <div class="dropzone-container">
      <Dropzone
        class="dropzone"
        multiple
        message="Drag file here or click to select"
        @change="onFileChange"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.upload {
  height: 100%;
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
