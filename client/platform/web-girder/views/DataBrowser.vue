<script lang="ts">
import {
  computed, defineComponent, inject, ref,
} from '@vue/composition-api';
import {
  GirderFileManager, getLocationType, RestClient, GirderModel,
} from '@girder/components/src';

import { useStore, LocationType } from '../store/types';
import { getLocationFromRoute } from '../utils';
import Upload from './Upload.vue';

export default defineComponent({
  components: {
    GirderFileManager,
    Upload,
  },

  setup(_, { root }) {
    const fileManager = ref();
    const store = useStore();
    const uploading = ref(false);
    const uploaderDialog = ref(false);
    const locationStore = store.state.Location;
    const { getters } = store;
    const girderRest = inject('girderRest') as RestClient;

    function setLocation(value: LocationType) {
      store.dispatch('Location/route', value);
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
      // TODO: update to check for other info
      return item._modelType === 'folder' && item.meta.annotate;
    }

    const shouldShowUpload = computed(() => (
      locationStore.location
      && !getters.locationIsViameFolder
      && getLocationType(locationStore.location) === 'folder'
      && !locationStore.selected.length
    ));

    /* Initialize the location in the store */
    setLocation(getLocationFromRoute(root.$route) || {
      _id: girderRest.user._id,
      _modelType: 'user',
    });

    return {
      fileManager,
      locationStore,
      getters,
      shouldShowUpload,
      uploaderDialog,
      uploading,
      /* methods */
      isAnnotationFolder,
      handleNotification,
      setLocation,
      updateUploading,
    };
  },
});
</script>


<template>
  <GirderFileManager
    ref="fileManager"
    v-model="locationStore.selected"
    :selectable="!getters.locationIsViameFolder"
    :new-folder-enabled="
      !locationStore.selected.length && !getters.locationIsViameFolder
    "
    :location="locationStore.location"
    @update:location="setLocation($event)"
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
          :location="locationStore.location"
          @update:uploading="updateUploading"
          @close="uploaderDialog = false"
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
</template>
