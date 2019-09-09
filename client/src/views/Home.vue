<script>
import { mapState, mapMutations } from "vuex";
import { FileManager } from "@girder/components/src/components/Snippet";
import { getLocationType } from "@girder/components/src/utils";

import Upload from "@/components/Upload";
import NavigationBar from "@/components/NavigationBar";

export default {
  name: "Home",
  components: { FileManager, Upload, NavigationBar },
  inject: ["girderRest"],
  data: () => ({ uploaderDialog: false, selected: [] }),
  computed: {
    ...mapState(["location"]),
    location_: {
      get() {
        return this.location;
      },
      set(value) {
        this.setLocation(value);
      }
    },
    shouldShowUpload() {
      return this.location && getLocationType(this.location) === "folder";
    },
    pipelines() {
      return ["detector_simple_hough"];
    },
    selectedEligibleClips() {
      return this.selected.filter(
        model => model._modelType === "item" && model.meta && model.meta.viame
      );
    }
  },
  created() {
    if (!this.location) {
      this.setLocation(this.girderRest.user);
    }
  },
  methods: {
    ...mapMutations(["setLocation"]),
    async rowClicked(item) {
      if (!item.meta || !item.meta.viame) {
        return;
      }
      var { data: clipMeta } = await this.girderRest.get(
        "viame_detection/clip_meta",
        {
          params: {
            itemId: item._id
          }
        }
      );
      if (
        clipMeta.detection &&
        (item.meta.type === "image-sequence" || clipMeta.video)
      ) {
        this.$router.push(`viewer/${item._id}`);
      } else {
        if (item.meta.type === "video") {
          this.$snackbar({
            text: "Missing detection result and/or being transcoded",
            timeout: 6000,
            immediate: true
          });
        } else if (item.meta.type === "image-sequence") {
          this.$snackbar({
            text: "Missing detection result",
            timeout: 6000,
            immediate: true
          });
        }
      }
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
    },
    dragover() {
      if (this.shouldShowUpload) {
        this.uploaderDialog = true;
      }
    },
    async runPipeline(pipeline) {
      var clips = this.selectedEligibleClips;
      await Promise.all(
        this.selectedEligibleClips.map(item => {
          return this.girderRest.post(
            `/viame/pipeline?itemId=${item._id}&pipeline=${pipeline}.pipe`
          );
        })
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
            :location.sync="location_"
            @selection-changed="selected = $event"
            @rowclick="rowClicked"
            @dragover.native="dragover"
          >
            <template #headerwidget>
              <v-menu offset-y>
                <template v-slot:activator="{ on }">
                  <v-btn
                    v-on="on"
                    text
                    small
                    :disabled="selectedEligibleClips.length < 1"
                  >
                    <v-icon left color="accent">mdi-pipe</v-icon>
                    Run pipeline
                  </v-btn>
                </template>
                <v-list>
                  <v-list-item
                    v-for="pipeline in pipelines"
                    :key="pipeline"
                    @click="runPipeline(pipeline)"
                  >
                    <v-list-item-title>{{ pipeline }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
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
                v-if="shouldShowUpload && !selected.length"
                v-model="uploaderDialog"
                max-width="600px"
              >
                <template #activator="{on}">
                  <v-btn v-on="on" class="ma-0" text small>
                    <v-icon left color="accent">mdi-file-upload</v-icon>
                    Upload
                  </v-btn>
                </template>
                <Upload
                  :location="location_"
                  @uploaded="
                    $refs.fileManager.$refs.girderBrowser.refresh();
                    uploaderDialog = false;
                  "
                />
              </v-dialog>
            </template>
          </FileManager>
        </v-col>
      </v-row>
    </v-container>
  </v-content>
</template>
