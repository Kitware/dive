<script>
import { mapState, mapMutations, mapActions } from 'vuex';
import { FileManager } from '@girder/components/src/components/Snippet';
import { getLocationType } from '@girder/components/src/utils';

import Upload from '@/components/Upload.vue';
import NavigationBar from '@/components/NavigationBar.vue';
import { getPathFromLocation, getLocationFromRoute } from '@/utils';

export default {
  name: 'Home',
  components: { FileManager, Upload, NavigationBar },
  inject: ['girderRest', 'notificationBus'],
  data: () => ({
    location_: null,
    uploaderDialog: false,
    selected: [],
    uploading: false,
  }),
  computed: {
    ...mapState(['location', 'pipelines']),

    location: {
      get() {
        return this.location_;
      },
      set(value) {
        this.location_ = value;
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
    selectedEligibleClips() {
      return this.selected.filter(
        (model) => model._modelType === 'folder' && model.meta && model.meta.viame,
      );
    },
    pipelinesRunnable() {
      return this.selectedEligibleClips.length < 1 || !this.pipelines.length;
    },
  },
  watch: {
    uploading(newval) {
      if (!newval) {
        this.$refs.fileManager.$refs.girderBrowser.refresh();
      }
    },
  },
  created() {
    this.location_ = getLocationFromRoute(this.$route);
    this.setLocation(this.location_);
    this.fetchPipelines();
    this.notificationBus.$on('message:job_status', this.handleNotification);
  },
  beforeDestroy() {
    this.notificationBus.$off('message:job_status', this.handleNotification);
  },
  beforeRouteUpdate(to, from, next) {
    this.location_ = getLocationFromRoute(to);
    next();
  },
  methods: {
    ...mapMutations(['setLocation', 'setPipelines']),
    ...mapActions(['fetchPipelines']),
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
      const formData = new FormData();
      formData.set(
        'resources',
        JSON.stringify({
          folder: this.selected
            .filter((resource) => resource._modelType === 'folder')
            .map((resource) => resource._id),
          item: this.selected
            .filter((resource) => resource._modelType === 'item')
            .map((resource) => resource._id),
        }),
      );
      await this.girderRest.post('resource', formData, {
        headers: { 'X-HTTP-Method-Override': 'DELETE' },
      });
      this.$refs.fileManager.$refs.girderBrowser.refresh();
      this.selected = [];
    },
    downloadClip() {
      function postDownload(url, data) {
        const form = document.createElement('form');
        form.setAttribute('action', url);
        form.setAttribute('method', 'POST');
        Object.entries(data).forEach(([key, value]) => {
          const input = document.createElement('input');
          input.setAttribute('type', 'text');
          input.setAttribute('name', key);
          input.setAttribute('value', value);
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
      }
      postDownload('api/v1/resource/download', {
        resources: JSON.stringify({
          folder: this.selected.map((dataset) => dataset._id),
        }),
      });
    },
    dragover() {
      if (this.shouldShowUpload) {
        this.uploaderDialog = true;
      }
    },
    uploaded(uploads) {
      this.uploaderDialog = false;

      // transcode video
      const transcodes = uploads.filter(({ results }) => {
        const videos = results.filter((result) => ['avi', 'mp4', 'mov', 'mpg'].includes(result.exts[0]));
        videos.forEach((result) => {
          this.girderRest.post(`/viame/conversion?itemId=${result.itemId}`);
        });
        return !!videos.length;
      });
      if (transcodes.length) {
        this.$snackbar({
          text: `Transcoding started on ${transcodes.length} clip${
            transcodes.length > 1 ? 's' : ''
          }`,
          timeout: 4500,
          button: 'View',
          callback: () => {
            this.$router.push('/jobs');
          },
        });
      }

      // run pipeline
      const runPipelines = uploads.filter(({ pipeline }) => pipeline);
      runPipelines.forEach(({ results, pipeline }) => this.runPipeline(
        results[0].itemId,
        pipeline,
      ));
      if (runPipelines.length) {
        this.$snackbar({
          text: `Started pipeline on ${runPipelines.length} clip${
            runPipelines.length > 1 ? 's' : ''
          }`,
          timeout: 4500,
          button: 'View',
          callback: () => {
            this.$router.push('/jobs');
          },
        });
      }

      // promote csv files to as its own result item
      uploads.forEach(({ folder, results }) => {
        const csvFiles = results.filter((result) => result.name.endsWith('.csv'));
        csvFiles.forEach((csvFile) => {
          this.girderRest.put(
            `/item/${csvFile.itemId}/metadata?allowNull=true`,
            {
              detection: folder._id,
            },
          );
        });
      });
    },
    async runPipeline(itemId, pipeline) {
      return this.girderRest.post(
        `/viame/pipeline?folderId=${itemId}&pipeline=${pipeline}`,
      );
    },
    async runPipelineOnSelectedItem(pipeline) {
      const clips = this.selectedEligibleClips;
      await Promise.all(
        this.selectedEligibleClips.map((item) => this.runPipeline(item._id, pipeline)),
      );
      this.$snackbar({
        text: `Started pipeline on ${clips.length} clip${
          clips.length ? 's' : ''
        }`,
        timeout: 6000,
        immediate: true,
        button: 'View',
        callback: () => {
          this.$router.push('/jobs');
        },
      });
    },
  },
};
</script>

<template>
  <v-content>
    <NavigationBar />
    <v-container fill-height>
      <v-row
        class="fill-height"
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
              <v-menu offset-y>
                <template v-slot:activator="{ on }">
                  <v-btn
                    text
                    small
                    :disabled="pipelinesRunnable"
                    v-on="on"
                  >
                    <v-icon
                      left
                      color="accent"
                    >
                      mdi-pipe
                    </v-icon>
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
                v-if="selectedEligibleClips.length === 1"
                class="ma-0"
                text
                small
                @click="downloadClip"
              >
                <v-icon
                  left
                  color="accent"
                  class="mdi-24px mr-1"
                >
                  mdi-download
                </v-icon>
                Download
              </v-btn>
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
                  @uploaded="uploaded"
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
