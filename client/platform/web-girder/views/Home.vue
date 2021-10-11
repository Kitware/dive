<script>
import {
  defineComponent,
  ref,
} from '@vue/composition-api';
import {
  GirderFileManager, GirderMarkdown,
} from '@girder/components/src';
import { mapGetters, mapState } from 'vuex';

import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import RunTrainingMenu from 'dive-common/components/RunTrainingMenu.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

import { deleteResources, getUri } from '../api';
import Export from './Export.vue';
import Upload from './Upload.vue';
import DataDetails from './DataDetails.vue';
import Clone from './Clone.vue';
import ShareTab from './ShareTab.vue';
import DataShared from './DataShared.vue';

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
    DataShared,
    ShareTab,
  },
  setup() {
    const loading = ref(false);
    const { prompt } = usePrompt();

    return {
      // data
      buttonOptions,
      menuOptions,
      loading,
      // methods
      prompt,
    };
  },
  // everything below needs to be refactored to composition-api
  inject: ['girderRest'],
  computed: {
    ...mapState('Location', ['selected', 'location']),
    ...mapGetters('Location', ['locationIsViameFolder']),
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
    selectedViameFolderIds() {
      return this.selected.filter(
        ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
      ).map(({ _id }) => _id);
    },
    locationInputs() {
      return this.locationIsViameFolder ? [this.location._id] : this.selectedViameFolderIds;
    },
    selectedDescription() {
      return this.location?.description;
    },
    summaryUrl() {
      return getUri({
        url: 'dive_summary/max_n',
        // eslint-disable-next-line @typescript-eslint/camelcase
        params: { folder_ids: JSON.stringify(this.locationInputs) },
      });
    },
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
        this.$refs.fileManager.$refs.girderBrowser.refresh();
        this.selected = [];
      } catch (err) {
        if (err instanceof TypeError) {
          return;
        }
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
                  :disabled="!locationInputs.length"
                  v-bind="{ ...buttonOptions }"
                  :href="summaryUrl"
                  target="_blank"
                >
                  <v-icon>
                    mdi-file-chart
                  </v-icon>
                  <span class="pl-1">
                    Generate Summary
                  </span>
                </v-btn>
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
