<script>
import Vue from 'vue';
import { mapMutations } from 'vuex';
import { getLocationType, GirderFileManager } from '@girder/components/src';

import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import RunTrainingMenu from 'dive-common/components/RunTrainingMenu.vue';

import { getPathFromLocation, getLocationFromRoute } from '../utils';
import { deleteResources } from '../api/viame.service';
import Export from './Export.vue';
import Upload from './Upload.vue';
import DataDetails from './DataDetails.vue';
import Clone from './Clone.vue';

const buttonOptions = {
  block: true,
  left: true,
  depressed: true,
  color: 'primary',
  class: ['my-2', 'd-flex', 'justify-start'],
};

const menuOptions = {
  offsetX: true,
  right: true,
  nudgeRight: 8,
};

export default Vue.extend({
  name: 'Home',
  components: {
    Clone,
    DataDetails,
    Export,
    GirderFileManager,
    Upload,
    RunPipelineMenu,
    RunTrainingMenu,
  },
  inject: ['girderRest'],
  data: () => ({
    buttonOptions,
    menuOptions,
    uploaderDialog: false,
    selected: [],
    uploading: false,
    loading: false,
  }),
  computed: {
    location: {
      get() {
        return this.$store.state.Location.location;
      },
      /**
       * This setter is used by Girder Web Components to set the location when it changes
       * by clicking on a Breadcrumb link
       */
      set(value) {
        if (this.locationIsViameFolder && value.name === 'auxiliary') {
          return;
        }
        const newPath = getPathFromLocation(value);
        if (this.$route.path !== newPath) {
          this.$router.push(newPath);
        }
        this.setLocation(value);
      },
    },
    shouldShowUpload() {
      return (
        this.location
        && !this.locationIsViameFolder
        && getLocationType(this.location) === 'folder'
        && !this.selected.length
      );
    },
    exportTarget() {
      let { selected } = this;
      if (selected.length === 1) {
        [selected] = selected;
        if (selected._modelType !== 'folder') {
          return null;
        }
        return selected;
      }
      if (this.locationIsViameFolder) {
        return this.location;
      }
      return null;
    },
    exportTargetId() {
      return this.exportTarget?._id || null;
    },
    locationIsViameFolder() {
      return !!(this.location && this.location.meta && this.location.meta.annotate);
    },
    selectedViameFolderIds() {
      return this.selected.filter(
        ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
      ).map(({ _id }) => _id);
    },
    locationInputs() {
      return this.locationIsViameFolder ? [this.location._id] : this.selectedViameFolderIds;
    },
  },
  watch: {
    uploading(newval) {
      if (!newval) {
        this.$refs.fileManager.$refs.girderBrowser.refresh();
        this.uploaderDialog = false;
      }
    },
  },
  async created() {
    this.setLocation(await getLocationFromRoute(this.$route));
    if (this.location === null) {
      const newloc = {
        _id: this.girderRest.user._id,
        _modelType: 'user',
      };
      this.setLocation(newloc);
      this.$router.push(getPathFromLocation(newloc));
    }
    this.girderRest.$on('message:job_status', this.handleNotification);
  },
  beforeDestroy() {
    this.girderRest.$off('message:job_status', this.handleNotification);
  },
  methods: {
    ...mapMutations('Location', ['setLocation']),
    handleNotification() {
      this.$refs.fileManager.$refs.girderBrowser.refresh();
    },
    isAnnotationFolder(item) {
      // TODO: update to check for other info
      return item._modelType === 'folder' && item.meta.annotate;
    },
    async deleteSelection() {
      const result = await this.$prompt({
        title: 'Confirm',
        text: 'Do you want to delete selected items?',
        confirm: true,
      });
      if (!result) {
        return;
      }
      try {
        this.loading = true;
        await deleteResources(this.selected);
        this.$refs.fileManager.$refs.girderBrowser.refresh();
        this.selected = [];
      } catch (err) {
        let text = 'Unable to delete resource(s)';
        if (err.response && err.response.status === 403) {
          text = 'You do not have permission to delete selected resource(s).';
        }
        this.$prompt({
          title: 'Delete Failed',
          text,
          positiveButton: 'OK',
        });
      } finally {
        this.loading = false;
      }
    },
    dragover() {
      if (this.shouldShowUpload) {
        this.uploaderDialog = true;
      }
    },
  },
});
</script>

<template>
  <div>
    <v-progress-linear
      :indeterminate="loading"
      height="6"
      :style="{ visibility: loading ? 'visible' : 'hidden' }"
    />
    <v-container
      fill-height
      :fluid="$vuetify.breakpoint.mdAndDown"
    >
      <v-row
        class="fill-height nowraptable"
      >
        <v-col cols="3">
          <DataDetails
            :value="selected.length ? selected : [location]"
          >
            <template #actions>
              <div class="pa-2">
                <Clone
                  :button-options="buttonOptions"
                  :source="exportTarget"
                />
                <run-training-menu
                  v-bind="{ buttonOptions, menuOptions }"
                  :selected-dataset-ids="locationInputs"
                />
                <run-pipeline-menu
                  v-bind="{ buttonOptions, menuOptions }"
                  :selected-dataset-ids="locationInputs"
                />
                <export
                  v-bind="{ buttonOptions, menuOptions }"
                  :dataset-id="exportTargetId"
                />
                <v-btn
                  :disabled="!selected.length"
                  v-bind="{ ...buttonOptions }"
                  color="error"
                  @click="deleteSelection"
                >
                  <v-icon>
                    mdi-delete
                  </v-icon>
                  <span class="pl-1">
                    Delete
                  </span>
                </v-btn>
              </div>
            </template>
          </DataDetails>
        </v-col>
        <v-col :cols="9">
          <GirderFileManager
            ref="fileManager"
            v-model="selected"
            :selectable="!locationIsViameFolder"
            :new-folder-enabled="!selected.length && !locationIsViameFolder"
            :location.sync="location"
            @dragover.native="dragover"
          >
            <template #headerwidget>
              <v-dialog
                v-if="shouldShowUpload"
                v-model="uploaderDialog"
                max-width="800px"
                :persistent="uploading"
              >
                <template #activator="{on}">
                  <v-btn
                    class="ma-0"
                    text
                    small
                    v-on="on"
                  >
                    <v-icon
                      left
                      color="accent"
                    >
                      mdi-file-upload
                    </v-icon>
                    Upload
                  </v-btn>
                </template>
                <Upload
                  :location="location"
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
                depressed
                :to="{ name: 'viewer', params: { id: item._id } }"
                @click.stop="openClip(item)"
              >
                Launch Annotator
              </v-btn>
              <v-chip
                v-if="(item.meta && item.meta.foreign_media_id)"
                color="white"
                x-small
                outlined
                disabled
                class="my-0 mx-3"
              >
                cloned
              </v-chip>
              <v-chip
                v-if="(item.meta && item.meta.published)"
                color="green"
                x-small
                outlined
                disabled
                class="my-0 mx-3"
              >
                published
              </v-chip>
            </template>
          </GirderFileManager>
        </v-col>
      </v-row>
    </v-container>
  </div>
</template>

<style lang='scss'>
.nowraptable table thead tr th .row {
  flex-wrap: nowrap;
}
</style>
