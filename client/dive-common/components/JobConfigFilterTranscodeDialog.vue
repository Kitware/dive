<script lang="ts">
import {
  computed,
  defineComponent,
  watch,
  ref,
  Ref,
  PropType,
} from 'vue';
import { GirderFileManager, GirderModelType } from '@girder/components/src';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import isDesktopRuntime from 'dive-common/isDesktopRuntime';
import type { NewDatasetJobConfig } from 'dive-common/apispec';

type DestinationLocation = {
  _id: string;
  _modelType: GirderModelType;
  name?: string;
  login?: string;
  meta?: { annotate?: boolean | string };
};

type RootPathCrumb = {
  object?: { _modelType?: string; login?: string; name?: string };
  _modelType?: string;
  login?: string;
  name?: string;
};

export default defineComponent({
  components: { GirderFileManager },
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    pipelineName: {
      type: String,
      required: true,
    },
    selectedDatasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  emits: ['cancel', 'submit'],
  setup(props, { emit }) {
    const formValid = ref(false);
    const dialogOpenTimestamp = ref('');
    const outputDatasetNames: Ref<Record<string, string>> = ref({});
    // Destination folder picker is Girder/web-only; desktop keeps name-only.
    const showDestinationPicker = !isDesktopRuntime();
    const location: Ref<DestinationLocation | null> = ref(null);
    const breadcrumbPath = ref('');
    const pickerOpen = ref(false);
    const draftLocation: Ref<DestinationLocation | null> = ref(null);
    const pathLoading = ref(false);

    const locationIsFolder = computed(
      () => location.value?._modelType === 'folder',
    );
    const draftIsFolder = computed(
      () => draftLocation.value?._modelType === 'folder',
    );
    const canSubmit = computed(
      () => formValid.value && (!showDestinationPicker || locationIsFolder.value),
    );
    const destinationButtonLabel = computed(() => {
      if (pathLoading.value) {
        return 'Loading destination…';
      }
      if (breadcrumbPath.value) {
        return breadcrumbPath.value;
      }
      if (location.value?.name) {
        return location.value.name;
      }
      return 'Choose a destination folder…';
    });

    function locationLabel(loc: DestinationLocation): string {
      if (loc._modelType === 'user') {
        return loc.login || loc.name || 'User';
      }
      return loc.name || loc._id;
    }

    async function refreshBreadcrumbPath(loc: DestinationLocation | null) {
      if (!loc || !showDestinationPicker) {
        breadcrumbPath.value = '';
        return;
      }
      pathLoading.value = true;
      try {
        const { default: girderRest } = await import('platform/web-girder/plugins/girder');
        const parts: string[] = [];
        if (loc._modelType === 'folder') {
          const { data: rootpath } = await girderRest.get(
            `folder/${loc._id}/rootpath_or_relative`,
          );
          (rootpath || []).forEach((crumb: RootPathCrumb) => {
            const obj = crumb.object || crumb;
            if (obj._modelType === 'user') {
              parts.push(obj.login || obj.name || 'User');
            } else if (obj.name) {
              parts.push(obj.name);
            }
          });
          if (loc.name) {
            parts.push(loc.name);
          } else {
            const { data: folder } = await girderRest.get(`folder/${loc._id}`);
            parts.push(folder.name || loc._id);
            location.value = {
              ...loc,
              name: folder.name,
            };
          }
        } else if (loc._modelType === 'user' || loc._modelType === 'collection') {
          const { data } = await girderRest.get(`${loc._modelType}/${loc._id}`);
          parts.push(
            loc._modelType === 'user' ? (data.login || data.name) : data.name,
          );
        } else {
          parts.push(locationLabel(loc));
        }
        breadcrumbPath.value = parts.filter(Boolean).join(' / ');
      } catch {
        breadcrumbPath.value = locationLabel(loc);
      } finally {
        pathLoading.value = false;
      }
    }

    async function initDestinationLocation() {
      if (!showDestinationPicker) {
        return;
      }
      pathLoading.value = true;
      try {
        const { default: girderRest } = await import('platform/web-girder/plugins/girder');
        const userId = girderRest.user?._id;
        const fallback: DestinationLocation | null = userId
          ? {
            _id: userId,
            _modelType: 'user',
            login: girderRest.user?.login,
          }
          : null;
        if (!props.selectedDatasetIds.length) {
          location.value = fallback;
        } else {
          try {
            const datasetId = parentDatasetId(props.selectedDatasetIds[0]);
            const { data: folder } = await girderRest.get(`folder/${datasetId}`);
            if (folder.parentCollection === 'folder' && folder.parentId) {
              const { data: parent } = await girderRest.get(`folder/${folder.parentId}`);
              location.value = {
                _id: parent._id,
                _modelType: 'folder',
                name: parent.name,
              };
            } else {
              location.value = fallback;
            }
          } catch {
            location.value = fallback;
          }
        }
        await refreshBreadcrumbPath(location.value);
      } finally {
        pathLoading.value = false;
      }
    }

    let destinationInitPromise: Promise<void> = Promise.resolve();

    watch(() => props.value, (open) => {
      if (!open) {
        pickerOpen.value = false;
        return;
      }
      dialogOpenTimestamp.value = (new Date()).toISOString().replace(/[:.]/g, '-');
      props.selectedDatasetIds.forEach((id: string) => {
        outputDatasetNames.value[id] = `${props.pipelineName}_${id}_${dialogOpenTimestamp.value}`;
      });
      destinationInitPromise = initDestinationLocation();
    });

    async function openFolderPicker() {
      await destinationInitPromise;
      if (!location.value) {
        await initDestinationLocation();
      }
      if (!location.value) {
        return;
      }
      draftLocation.value = { ...location.value };
      pickerOpen.value = true;
    }

    function setDraftLocation(newLoc: DestinationLocation) {
      // Match Clone.vue: do not navigate into annotate datasets.
      if (!('meta' in newLoc && newLoc.meta?.annotate)) {
        draftLocation.value = newLoc;
      }
    }

    async function confirmFolderPicker() {
      if (!draftIsFolder.value || !draftLocation.value) {
        return;
      }
      location.value = { ...draftLocation.value };
      pickerOpen.value = false;
      await refreshBreadcrumbPath(location.value);
    }

    function cancelFolderPicker() {
      pickerOpen.value = false;
      draftLocation.value = null;
    }

    function cancelPipeline() {
      pickerOpen.value = false;
      emit('cancel');
    }

    const requiredRule = (v: string) => !!v || 'Each output dataset must have a name';

    function submitPipelines() {
      const payload: NewDatasetJobConfig = {
        names: outputDatasetNames.value,
      };
      if (showDestinationPicker && locationIsFolder.value && location.value) {
        payload.parentFolderId = location.value._id;
      }
      emit('submit', payload);
    }

    return {
      formValid,
      canSubmit,
      requiredRule,
      outputDatasetNames,
      showDestinationPicker,
      location,
      locationIsFolder,
      breadcrumbPath,
      destinationButtonLabel,
      pathLoading,
      pickerOpen,
      draftLocation,
      draftIsFolder,
      openFolderPicker,
      setDraftLocation,
      confirmFolderPicker,
      cancelFolderPicker,
      cancelPipeline,
      submitPipelines,
    };
  },
});
</script>

<template>
  <div>
    <v-dialog
      v-model="value"
      width="67%"
    >
      <v-card outlined>
        <v-card-title>
          Job Configuration
        </v-card-title>
        <v-card-text class="d-flex flex-column justify-center">
          You have selected a pipeline that will create a new dataset. Please choose a
          name for that dataset.
          <v-form
            v-model="formValid"
            class="mt-2"
          >
            <v-col>
              <v-row
                v-for="datasetId in selectedDatasetIds"
                :key="datasetId"
                class="d-flex justify-center align-end"
              >
                <v-col>
                  <v-label>
                    {{ datasetId }}
                  </v-label>
                </v-col>
                <v-col>
                  <v-text-field
                    v-model="outputDatasetNames[datasetId]"
                    class="ml-2"
                    label="Output dataset name"
                    :rules="[requiredRule]"
                    hide-details
                  />
                </v-col>
              </v-row>
            </v-col>
          </v-form>
          <template v-if="showDestinationPicker">
            <div class="mt-4 mb-2">
              Destination folder
              <span
                v-if="selectedDatasetIds.length > 1"
                class="text--secondary"
              >
                (shared for all selected datasets)
              </span>
            </div>
            <v-btn
              outlined
              block
              class="destination-path-btn text-none justify-start"
              :loading="pathLoading"
              @click="openFolderPicker"
            >
              <v-icon left>
                mdi-folder-outline
              </v-icon>
              <span class="destination-path-label text-truncate">
                {{ destinationButtonLabel }}
              </span>
              <v-spacer />
              <v-icon>
                mdi-folder-open-outline
              </v-icon>
            </v-btn>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="error"
            @click="cancelPipeline"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!canSubmit"
            @click="submitPipelines"
          >
            Submit
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="pickerOpen"
      width="800"
      :overlay-opacity="0.95"
    >
      <v-card v-if="draftLocation">
        <v-card-title>
          Choose destination folder
        </v-card-title>
        <v-card-text>
          Select the folder that should contain the new dataset.
          <v-card
            outlined
            flat
            class="mt-3"
          >
            <GirderFileManager
              new-folder-enabled
              root-location-disabled
              no-access-control
              :location="draftLocation"
              @update:location="setDraftLocation"
            >
              <template #row="{ item }">
                <span>{{ item.name }}</span>
                <v-chip
                  v-if="(item.meta && item.meta.annotate)"
                  color="white"
                  x-small
                  outlined
                  class="mx-3"
                >
                  dataset
                </v-chip>
              </template>
            </GirderFileManager>
          </v-card>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            @click="cancelFolderPicker"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!draftIsFolder"
            @click="confirmFolderPicker"
          >
            <span v-if="!draftIsFolder">
              Choose a folder...
            </span>
            <span v-else-if="draftLocation && draftLocation.name">
              Use {{ draftLocation.name }}
            </span>
            <span v-else>
              Use this folder
            </span>
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.destination-path-btn {
  max-width: 100%;
}
.destination-path-label {
  max-width: calc(100% - 72px);
  text-align: left;
}
</style>
