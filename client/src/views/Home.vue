<script>
import { mapState, mapMutations } from "vuex";
import { FileManager } from "@girder/components/src/components/Snippet";

import Upload from "@/components/Upload";
import NavigationBar from "@/components/NavigationBar";

export default {
  name: "Home",
  components: { FileManager, Upload, NavigationBar },
  data: () => ({}),
  computed: {
    ...mapState(["location"]),
    location_: {
      get() {
        return this.location;
      },
      set(value) {
        this.setLocation(value);
      }
    }
  },
  methods: {
    ...mapMutations(["setLocation"]),
    rowClicked(item) {
      if (!item.meta || !item.meta.viame) {
        return;
      }
      this.$router.push(`viewer/${item._id}`);
    }
  }
};
</script>

<template>
  <v-content>
    <NavigationBar />
    <v-container fill-height fluid class="pa-0">
      <v-row class="fill-height" no-gutters>
        <v-col :cols="7">
          <FileManager
            ref="fileManager"
            new-folder-enabled
            :location.sync="location_"
            @rowclick="rowClicked"
          />
        </v-col>
        <v-col :cols="5" fill-height>
          <Upload
            :location="location_"
            @uploaded="$refs.fileManager.$refs.girderBrowser.refresh()"
          />
        </v-col>
      </v-row>
    </v-container>
  </v-content>
</template>
