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
    }
  },
  methods: {
    ...mapMutations(["setLocation"]),
    rowClicked(item) {
      if (!item.meta || !item.meta.viame) {
        return;
      }
      this.$router.push(`viewer/${item._id}`);
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
            new-folder-enabled
            selectable
            :location.sync="location_"
            @selection-changed="selected = $event"
            @rowclick="rowClicked"
            @dragover.native="dragover"
          >
            <template #headerwidget>
              <v-btn
                class="ma-0"
                v-if="selected.length"
                text
                small
                color="secondary darken-2"
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
                full-width
                max-width="600px"
              >
                <template #activator="{on}">
                  <v-btn
                    v-on="on"
                    class="ma-0"
                    text
                    small
                    color="secondary darken-2"
                  >
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
