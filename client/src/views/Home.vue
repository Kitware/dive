<script>
import { mapMutations } from 'vuex';
import { FileManager } from '@girder/components/src/components/Snippet';
import { getLocationType } from '@girder/components/src/utils';
import Export from '@/components/Export.vue';
import RunPipelineMenu from '@/components/RunPipelineMenu.vue';
import Upload from '@/components/Upload.vue';
import NavigationBar from '@/components/NavigationBar.vue';
import { getPathFromLocation, getLocationFromRoute } from '@/utils';
import { deleteResources } from '@/lib/api/viame.service';

export default {
  name: 'Home',
  components: {
    Export,
    FileManager,
    Upload,
    NavigationBar,
    RunPipelineMenu,
  },
  inject: ['notificationBus'],
  data: () => ({
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
        return {
          title: selected.name,
          folderId: selected._id,
          folderType: selected.meta && selected.meta.type,
          isViameFolder: selected.meta && selected.meta.annotate,
        };
      }
      return null;
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
  created() {
    this.setLocation(getLocationFromRoute(this.$route));
    this.notificationBus.$on('message:job_status', this.handleNotification);
  },
  beforeDestroy() {
    this.notificationBus.$off('message:job_status', this.handleNotification);
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
};
</script>

<template>
  <v-content>
    <NavigationBar />
    <v-progress-linear
      :indeterminate="loading"
      height="6"
      :style="{ visibility: loading ? 'visible' : 'hidden' }"
    />
    <v-container fill-height>
      <v-row
        class="fill-height nowraptable"
        no-gutters
      >
        <v-col :cols="12">
          <FileManager
            ref="fileManager"
            v-model="selected"
            :new-folder-enabled="!selected.length"
            selectable
            :location.sync="location"
            @dragover.native="dragover"
          >
            <template #headerwidget>
              <run-pipeline-menu
                :selected="selected"
                small
              />
              <export
                v-if="exportTarget"
                v-bind="exportTarget"
                small
              />
              <v-btn
                v-if="selected.length"
                class="ma-0"
                text
                small
                @click="deleteSelection"
              >
                <v-icon
                  left
                  color="accent"
                  class="mdi-24px mr-1"
                >
                  mdi-delete
                </v-icon>
                Delete
              </v-btn>
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
                :to="{ name: 'viewer', params: { datasetId: item._id } }"
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

<style lang='scss'>
.nowraptable table thead tr th .row {
  flex-wrap: nowrap;
}
</style>
