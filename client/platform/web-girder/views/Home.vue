<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
} from 'vue';
import {
  GirderFileManager, GirderMarkdown,
} from '@girder/components/src';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import type { SubType } from 'dive-common/apispec';
import { getMultiCamCameraCount } from 'dive-common/pipelineMenuFilters';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useConfig } from '../store/useConfig';
import { useJobs } from '../store/useJobs';
import { useLocation } from '../store/useLocation';
import RunTrainingMenu from './RunTrainingMenu.vue';

import { deleteResources } from '../api';
import Export from './Export.vue';
import Upload from './Upload.vue';
import DataDetails from './DataDetails.vue';
import Clone from './Clone.vue';
import ShareTab from './ShareTab.vue';
import eventBus from '../eventBus';

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

export default defineComponent({
  name: 'Home',
  components: {
    Clone,
    DataDetails,
    Export,
    GirderFileManager,
    GirderMarkdown,
    Upload,
    RunPipelineMenu,
    RunTrainingMenu,
    ShareTab,
  },
  // everything below needs to be refactored to composition-api
  inject: ['girderRest'],
  setup() {
    const loading = ref(false);
    const { prompt } = usePrompt();
    const {
      location, selected, locationIsViameFolder, setSelected,
    } = useLocation();
    const { pipelinesEnabled, trainingEnabled } = useConfig();
    const jobs = useJobs();

    const clearSelected = () => {
      setSelected([]);
    };

    const runningPipelines = computed(() => {
      const results = [];
      const inputs = locationIsViameFolder.value && location.value
        ? [(location.value as { _id: string })._id]
        : selected.value.filter(
          ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
        ).map(({ _id }) => _id);
      inputs.forEach((item) => {
        if (jobs.getDatasetRunningState(item)) {
          results.push(item);
        }
      });
      return results;
    });

    const selectedViameFolders = computed(() => selected.value.filter(
      ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
    ));

    const selectedViameFolderIds = computed(() => selectedViameFolders.value.map(({ _id }) => _id));

    const selectedViameFolderNames = computed(() => selectedViameFolders.value.map(({ name }) => name));

    const pipelineTargetFolders = computed(() => (
      locationIsViameFolder.value && location.value
        ? [location.value]
        : selectedViameFolders.value
    ));

    const subTypeList = computed((): SubType[] => pipelineTargetFolders.value.map(
      (item) => item.meta?.subType ?? null,
    ));

    const cameraNumbers = computed(() => pipelineTargetFolders.value.map(
      (item) => getMultiCamCameraCount(item.meta),
    ));

    const datasetTypeList = computed(() => pipelineTargetFolders.value.map(
      (item) => item.meta?.type ?? null,
    ));

    const selectedFileIds = computed(() => selected.value.filter(
      (element) => element._modelType === 'item',
    ).map(({ _id }) => _id));

    const includesLargeImage = computed(() => (selected.value.filter(
      ({ meta }) => meta && meta.type === 'large-image',
    )).length > 0);

    const locationInputs = computed(() => (
      locationIsViameFolder.value && location.value
        ? [(location.value as { _id: string })._id]
        : selectedViameFolderIds.value
    ));

    const locationInputNames = computed(() => (
      locationIsViameFolder.value && location.value
        ? [(location.value as { name: string }).name]
        : selectedViameFolderNames.value
    ));

    const selectedDescription = computed(() => (location.value as { description?: string } | null)?.description);

    return {
      // data
      buttonOptions,
      menuOptions,
      loading,
      location,
      selected,
      locationIsViameFolder,
      pipelinesEnabled,
      trainingEnabled,
      runningPipelines,
      selectedViameFolderIds,
      selectedViameFolderNames,
      subTypeList,
      cameraNumbers,
      datasetTypeList,
      selectedFileIds,
      includesLargeImage,
      locationInputs,
      locationInputNames,
      selectedDescription,
      // methods
      prompt,
      clearSelected,
      eventBus,
    };
  },
  methods: {
    async deleteSelection() {
      const result = await this.prompt({
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
        eventBus.$emit('refresh-data-browser');
        this.clearSelected();
      } catch (err) {
        let text = 'Unable to delete resource(s)';
        if (err.response && err.response.status === 403) {
          text = 'You do not have permission to delete selected resource(s).';
        }
        this.prompt({
          title: 'Delete Failed',
          text,
          positiveButton: 'OK',
        });
      } finally {
        this.loading = false;
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
                  v-bind="{ buttonOptions, menuOptions }"
                  :dataset-id="locationInputs.length === 1 ? locationInputs[0] : null"
                />
                <run-training-menu
                  v-if="trainingEnabled"
                  v-bind="{
                    buttonOptions:
                      { ...buttonOptions, disabled: includesLargeImage },
                    menuOptions,
                  }"
                  :selected-dataset-ids="locationInputs"
                />
                <run-pipeline-menu
                  v-if="pipelinesEnabled"
                  v-bind="{
                    buttonOptions:
                      { ...buttonOptions, disabled: includesLargeImage },
                    menuOptions,
                    subTypeList,
                    cameraNumbers,
                    typeList: datasetTypeList,
                  }"
                  :selected-dataset-ids="locationInputs"
                  :selected-dataset-name="locationInputNames"
                  :running-pipelines="runningPipelines"
                />
                <export
                  v-bind="{ buttonOptions, menuOptions }"
                  :dataset-ids="locationInputs"
                  :file-ids="selectedFileIds"
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
          <v-toolbar
            dense
            class="mb-4"
            rounded
          >
            <ShareTab
              :value="0"
            />
          </v-toolbar>
          <router-view />
          <v-card
            v-if="selectedDescription"
            class="my-4"
          >
            <GirderMarkdown
              :text="selectedDescription"
              class="pa-3"
            />
          </v-card>
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
