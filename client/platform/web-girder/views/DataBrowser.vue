<script lang="ts">
import {
  computed, defineComponent, inject, ref,
} from '@vue/composition-api';
import {
  GirderFileManager, getLocationType, RestClient, GirderModel,
} from '@girder/components/src';

import { getFolder } from '../api/girder.service';

import { isGirderModel, useStore, LocationType } from '../store/types';
import Upload from './Upload.vue';
import { getLocationFromRoute } from '../utils';

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

    const location = computed({
      get() {
        return locationStore.location;
      },
      /**
       * This setter is used by Girder Web Components to set the location when it changes
       * by clicking on a Breadcrumb link
       */
      set(value: null | LocationType) {
        /* Prevent navigation into auxiliary folder */
        if (isGirderModel(value) && getters.locationIsViameFolder && value?.name === 'auxiliary') {
          return;
        }
        store.dispatch('Location/route', value);
      },
    });

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
      location.value
      && !getters.locationIsViameFolder
      && getLocationType(location.value) === 'folder'
      && !locationStore.selected.length
    ));

    async function init() {
      // TODO fix types here
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      let newLocaction = getLocationFromRoute(root.$route);
      if (newLocaction === null) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        newLocaction = {
          _id: girderRest.user._id,
          _modelType: 'user',
        };
      }
      location.value = newLocaction;
      if (isGirderModel(newLocaction) && newLocaction?._modelType === 'folder') {
        location.value = (await getFolder(newLocaction._id)).data;
      }
    }

    init();

    return {
      fileManager,
      location,
      locationStore,
      getters,
      shouldShowUpload,
      uploaderDialog,
      uploading,
      /* methods */
      isAnnotationFolder,
      handleNotification,
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
    :location.sync="location"
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
