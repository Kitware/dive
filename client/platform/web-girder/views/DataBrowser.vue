<script lang="ts">
import {
  computed, defineComponent, ref, onBeforeUnmount,
} from 'vue';
import {
  getLocationType, GirderModel,
} from '@girder/components';
import { itemsPerPageOptions } from 'dive-common/constants';
import {
  getMultiCamIcon,
  getMultiCamSubType,
  getMultiCamTooltip,
} from 'dive-common/multicamDisplay';
import { clientSettings } from 'dive-common/store/settings';
import { LocationType } from '../store/types';
import { useLocation } from '../store/useLocation';
import { useJobs } from '../store/useJobs';
import Upload from './Upload.vue';
import eventBus from '../eventBus';
import { reportHandledPromiseRejection } from '../reportHandledPromiseRejection';

import DiveGirderBrowser from './DiveGirderBrowser.vue';

export default defineComponent({
  components: {
    DiveGirderBrowser,
    Upload,
  },

  setup() {
    const fileManager = ref();
    const uploading = ref(false);
    const uploaderDialog = ref(false);
    const {
      location, selected, locationIsViameFolder, setRouteFromLocation, setSelected,
    } = useLocation();
    const jobs = useJobs();

    function setLocation(loc: LocationType) {
      setRouteFromLocation(loc).catch((reason) => {
        reportHandledPromiseRejection('DataBrowser: setRouteFromLocation', reason);
      });
    }

    function handleNotification() {
      fileManager.value.$refs.girderBrowser.refresh();
    }

    function updateUploading(newval: boolean) {
      uploading.value = newval;
      if (!newval) {
        fileManager.value.$refs.girderBrowser.refresh();
        uploaderDialog.value = false;
      }
    }

    function isAnnotationFolder(item: GirderModel) {
      return item._modelType === 'folder' && item.meta.annotate;
    }

    function multiCamSubType(item: GirderModel) {
      return getMultiCamSubType(item.meta);
    }

    const shouldShowUpload = computed(() => (
      location.value
      && !locationIsViameFolder.value
      && getLocationType(location.value) === 'folder'
      && !selected.value.length
    ));

    function updateRowsPerPage(count: number) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        clientSettings.rowsPerPage = count;
      }
    }

    eventBus.$on('refresh-data-browser', handleNotification);
    onBeforeUnmount(() => {
      eventBus.$off('refresh-data-browser', handleNotification);
    });

    return {
      fileManager,
      location,
      selected,
      locationIsViameFolder,
      jobs,
      shouldShowUpload,
      uploaderDialog,
      uploading,
      clientSettings,
      itemsPerPageOptions,
      /* methods */
      isAnnotationFolder,
      multiCamSubType,
      getMultiCamIcon,
      getMultiCamTooltip,
      handleNotification,
      setLocation,
      setSelected,
      updateRowsPerPage,
      updateUploading,
    };
  },
});
</script>

<template>
  <DiveGirderBrowser
    ref="fileManager"
    :value="selected"
    :selectable="!locationIsViameFolder"
    :new-folder-enabled="
      !selected.length && !locationIsViameFolder
    "
    :location="location"
    :items-per-page="clientSettings.rowsPerPage"
    :items-per-page-options="itemsPerPageOptions"
    @input="setSelected"
    @update:itemsPerPage="updateRowsPerPage"
    @update:location="setLocation($event)"
  >
    <template #headerwidget>
      <v-dialog
        v-if="shouldShowUpload"
        v-model="uploaderDialog"
        max-width="800px"
        :persistent="uploading"
      >
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            class="ma-0"
            variant="text"
            size="small"
          >
            <v-icon
              start
              color="accent"
              icon="mdi-file-upload"
            />
            Upload
          </v-btn>
        </template>
        <Upload
          :location="location"
          @update:uploading="updateUploading"
          @close="uploaderDialog = false"
        />
      </v-dialog>
    </template>
    <template #row="{ item }">
      <div class="dataset-row">
        <v-tooltip
          v-if="multiCamSubType(item)"
          bottom
        >
          <template #activator="{ props: activatorProps }">
            <v-icon
              size="small"
              class="mr-1"
              v-bind="activatorProps"
              :icon="getMultiCamIcon(multiCamSubType(item))"
            />
          </template>
          <span>{{ getMultiCamTooltip(multiCamSubType(item)) }}</span>
        </v-tooltip>
        <span>{{ item.name }}</span>
        <v-icon
          v-if="jobs.getDatasetRunningState(item._id)"
          color="warning"
          class="rotate ml-2"
        >
          mdi-autorenew
        </v-icon>
        <v-btn
          v-if="isAnnotationFolder(item)"
          class="ml-2"
          size="x-small"
          color="primary"
          variant="flat"
          :to="{ name: 'viewer', params: { id: item._id } }"
          @click.stop
        >
          Launch Annotator
        </v-btn>
        <v-chip
          v-if="(item.foreign_media_id)"
          color="white"
          size="x-small"
          variant="outlined"
          disabled
          class="my-0 mx-3"
        >
          cloned
        </v-chip>
        <v-chip
          v-if="(item.meta && item.meta.published)"
          color="green"
          size="x-small"
          variant="outlined"
          disabled
          class="my-0 mx-3"
        >
          published
        </v-chip>
      </div>
    </template>
  </DiveGirderBrowser>
</template>

<style lang="scss" scoped>
.dataset-row {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
}
</style>
