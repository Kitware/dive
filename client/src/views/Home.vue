<script>
import { mapState, mapMutations, mapActions } from "vuex";
import { FileManager } from "@girder/components/src/components/Snippet";
import { getLocationType } from "@girder/components/src/utils";

import Upload from "@/components/Upload";
import NavigationBar from "@/components/NavigationBar";
import { getPathFromLocation, getLocationFromRoute } from "@/utils";

export default {
  name: "Home",
  components: { FileManager, Upload, NavigationBar },
  inject: ["girderRest"],
  data: () => ({
    location_: null,
    uploaderDialog: false,
    selected: [],
    uploading: false
  }),
  computed: {
    ...mapState(["location", "pipelines"]),
    location: {
      get() {
        return this.location_;
      },
      set(value) {
        this.location_ = value;
        var newPath = getPathFromLocation(value);
        if (this.$route.path !== newPath) {
          this.$router.push(newPath);
        }
        this.setLocation(value);
      }
    },
    shouldShowUpload() {
      return (
        this.location &&
        getLocationType(this.location) === "folder" &&
        !this.selected.length
      );
    },
    selectedEligibleClips() {
      return this.selected.filter(
        model => model._modelType === "folder" && model.meta && model.meta.viame
      );
    },
    pipelinesRunnable() {
      return this.selectedEligibleClips.length < 1 || !this.pipelines.length;
    }
  },
  created() {
    this.location_ = getLocationFromRoute(this.$route);
    this.setLocation(this.location_);
    this.fetchPipelines();
  },
  beforeRouteUpdate(to, from, next) {
    this.location_ = getLocationFromRoute(to);
    next();
  },
  methods: {
    ...mapMutations(["setLocation", "setPipelines"]),
    ...mapActions(["fetchPipelines"]),
    isAnnotationFolder(item) {
      // Will be updated to check for other info
      return item._modelType === "folder" && item.meta.annotate;
    },
    async openClip(folder) {
      this.$router.push(`/viewer/${folder._id}`);
    },
    async deleteSelection() {
      var result = await this.$prompt({
        title: "Confirm",
        text: "Do you want to delete selected items?",
        confirm: true
      });
      if (!result) {
        return;
      }
      var formData = new FormData();
      formData.set(
        "resources",
        JSON.stringify({
          folder: this.selected
            .filter(resource => resource._modelType === "folder")
            .map(resource => resource._id),
          item: this.selected
            .filter(resource => resource._modelType === "item")
            .map(resource => resource._id)
        })
      );
      await this.girderRest.post("resource", formData, {
        headers: { "X-HTTP-Method-Override": "DELETE" }
      });
      this.$refs.fileManager.$refs.girderBrowser.refresh();
      this.selected = [];
    },
    downloadClip() {
      postDownload(`api/v1/resource/download`, {
        resources: JSON.stringify({
          folder: this.selected.map(dataset => dataset._id)
        })
      });

      function postDownload(url, data) {
        var form = document.createElement("form");
        form.setAttribute("action", url);
        form.setAttribute("method", "POST");
        Object.entries(data).map(([key, value]) => {
          var input = document.createElement("input");
          input.setAttribute("type", "text");
          input.setAttribute("name", key);
          input.setAttribute("value", value);
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
      }
    },
    dragover() {
      if (this.shouldShowUpload) {
        this.uploaderDialog = true;
      }
    },
    uploaded(uploads) {
      this.$refs.fileManager.$refs.girderBrowser.refresh();
      this.uploaderDialog = false;

      // transcode video
      var transcodes = uploads.filter(({ results }) => {
        var videos = results.filter(result =>
          ["avi", "mp4", "mov"].includes(result.exts[0])
        );
        videos.forEach(result => {
          this.girderRest.post(`/viame/conversion?itemId=${result.itemId}`);
        });
        return !!videos;
      });
      if (transcodes.length) {
        this.$snackbar({
          text: `Transcoding started on ${transcodes.length} clip${
            transcodes.length > 1 ? "s" : ""
          }`,
          timeout: 4500,
          button: "View",
          callback: () => {
            this.$router.push("/jobs");
          }
        });
      }

      // run pipeline
      var runPipelines = uploads.filter(({ pipeline }) => pipeline);
      runPipelines.forEach(({ results, pipeline }) =>
        this.runPipeline(results[0].itemId, pipeline)
      );
      if (runPipelines.length) {
        this.$snackbar({
          text: `Started pipeline on ${runPipelines.length} clip${
            runPipelines.length > 1 ? "s" : ""
          }`,
          timeout: 4500,
          button: "View",
          callback: () => {
            this.$router.push("/jobs");
          }
        });
      }

      //promote csv files to as its own result item
      uploads.forEach(({ folder, results }) => {
        var csvFiles = results.filter(result => result.name.endsWith(".csv"));
        csvFiles.forEach(csvFile => {
          this.girderRest.put(
            `/item/${csvFile.itemId}/metadata?allowNull=true`,
            {
              folderId: folder["_id"],
              pipeline: null
            }
          );
        });
      });
    },
    async runPipeline(itemId, pipeline) {
      return this.girderRest.post(
        `/viame/pipeline?folderId=${itemId}&pipeline=${pipeline}`
      );
    },
    async runPipelineOnSelectedItem(pipeline) {
      var clips = this.selectedEligibleClips;
      await Promise.all(
        this.selectedEligibleClips.map(item =>
          this.runPipeline(item._id, pipeline)
        )
      );
      this.$snackbar({
        text: `Started pipeline on ${clips.length} clip${
          clips.length ? "s" : ""
        }`,
        timeout: 6000,
        immediate: true,
        button: "View",
        callback: () => {
          this.$router.push("/jobs");
        }
      });
    }
  }
};
</script>

<template>
  <v-content>
    <NavigationBar />
    <v-container fill-height>
      <v-row class="fill-height" no-gutters>
        <v-col :cols="12">
          <FileManager
            ref="fileManager"
            :new-folder-enabled="!selected.length"
            selectable
            :location.sync="location"
            v-model="selected"
            @dragover.native="dragover"
          >
            <template #headerwidget>
              <v-menu offset-y>
                <template v-slot:activator="{ on }">
                  <v-btn v-on="on" text small :disabled="pipelinesRunnable">
                    <v-icon left color="accent">mdi-pipe</v-icon>
                    Run pipeline
                  </v-btn>
                </template>
                <v-list>
                  <v-list-item
                    v-for="pipeline in pipelines"
                    :key="pipeline"
                    @click="runPipelineOnSelectedItem(pipeline)"
                  >
                    <v-list-item-title>{{ pipeline }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-btn
                class="ma-0"
                v-if="selectedEligibleClips.length === 1"
                text
                small
                @click="downloadClip"
              >
                <v-icon left color="accent" class="mdi-24px mr-1"
                  >mdi-download</v-icon
                >
                Download
              </v-btn>
              <v-btn
                class="ma-0"
                v-if="selected.length"
                text
                small
                @click="deleteSelection"
              >
                <v-icon left color="accent" class="mdi-24px mr-1"
                  >mdi-delete</v-icon
                >
                Delete
              </v-btn>
              <v-dialog
                v-if="shouldShowUpload"
                v-model="uploaderDialog"
                max-width="800px"
                :persistent="uploading"
              >
                <template #activator="{on}">
                  <v-btn v-on="on" class="ma-0" text small>
                    <v-icon left color="accent">mdi-file-upload</v-icon>
                    Upload
                  </v-btn>
                </template>
                <Upload
                  :location="location"
                  @uploaded="uploaded"
                  :uploading.sync="uploading"
                />
              </v-dialog>
            </template>
            <template #row-widget="{item}">
              <v-btn
                v-if="isAnnotationFolder(item)"
                class="ml-2"
                x-small
                color="primary"
                @click.stop="openClip(item)"
              >
                Annotate
              </v-btn>
            </template>
          </FileManager>
        </v-col>
      </v-row>
    </v-container>
  </v-content>
</template>
