<script>
import Vue from 'vue';

import {
  GirderDataBrowser,
  GirderUpload,
  GirderUpsertFolder,
  GirderBreadcrumb,
  GirderAccessControl,
  getLocationType,
  isRootLocation,
  createLocationValidator,
} from '@girder/components/src';
import DataSharedBreadCrumb from './DataSharedBreadCrumb.vue';

export default Vue.extend({
  components: {
    GirderAccessControl,
    GirderBreadcrumb,
    GirderUpload,
    GirderUpsertFolder,
    GirderDataBrowser,
    DataSharedBreadCrumb,
  },

  inject: ['girderRest'],

  props: {
    value: {
      type: Array,
      default: () => [],
    },
    location: {
      type: Object,
      validator: createLocationValidator(true),
      default: null,
    },
    rootLocationDisabled: {
      type: Boolean,
      default: false,
    },
    noAccessControl: {
      type: Boolean,
      default: false,
    },
    selectable: {
      type: Boolean,
      default: false,
    },
    dragEnabled: {
      type: Boolean,
      default: false,
    },
    uploadEnabled: {
      type: Boolean,
      default: false,
    },
    newFolderEnabled: {
      type: Boolean,
      default: false,
    },
    uploadMaxShow: {
      type: Number,
      default: 0,
    },
    uploadMultiple: {
      type: Boolean,
      default: false,
    },
    uploadAccept: {
      type: String,
      default: '*',
    },
    preUpload: {
      type: Function,
      default: async () => {},
    },
    postUpload: {
      type: Function,
      default: async () => {},
    },
    preUpsert: {
      type: Function,
      default: async () => {},
    },
    postUpsert: {
      type: Function,
      default: async () => {},
    },
    itemsPerPage: {
      type: Number,
      default: 10,
    },
    itemsPerPageOptions: {
      type: Array,
      default: () => ([10, 25, 50]),
    },
  },

  data() {
    return {
      uploaderDialog: false,
      newFolderDialog: false,
      lazyLocation: null,
      collectionAndFolderMenu: {
        show: false,
        x: 0,
        y: 0,
      },
      actOnItem: null,
      showAccessControlDialog: false,
      hasAccessPermission: false,
    };
  },

  computed: {
    internalLocation: {
      get() {
        const { location, lazyLocation } = this;
        if (location) {
          return location;
        } if (lazyLocation) {
          return lazyLocation;
        }
        return { type: 'root' };
      },
      set(newVal) {
        this.lazyLocation = newVal;
        this.$emit('update:location', newVal);
      },
    },
    uploadDest() {
      const { internalLocation } = this;
      return (internalLocation && getLocationType(internalLocation) === 'folder')
        ? internalLocation
        : null;
    },
    shouldShowUpload() {
      return this.uploadEnabled
        && !isRootLocation(this.internalLocation)
        && this.girderRest.user
        && this.uploadDest;
    },
  },

  created() {
    if (!createLocationValidator(!this.rootLocationDisabled)(this.internalLocation)) {
      throw new Error('root location cannot be used when root-location-disabled is true');
    }
  },

  methods: {
    isRootLocation,
    refresh() {
      this.$refs.girderBrowser.refresh();
    },
    postUploadInternal() {
      // postUpload is an example of using hooks for greater control of component behavior.
      // here, we can complete the dialog disappear animation before the upload UI resets.
      this.$refs.girderBrowser.refresh();
      this.uploaderDialog = false;
      return Promise.all([
        new Promise((resolve) => setTimeout(resolve, 400)),
        this.postUpload(),
      ]);
    },
    postUpsertInternal() {
      this.$refs.girderBrowser.refresh();
      this.newFolderDialog = false;
      return Promise.all([
        new Promise((resolve) => setTimeout(resolve, 400)),
        this.postUpsert(),
      ]);
    },
    rowRightClick(row, e) {
      // currently there is only one item on the menu. so when no access control, there is no menu.
      if (this.noAccessControl) {
        return;
      }
      if (['collection', 'folder'].indexOf(row._modelType) !== -1) {
        e.preventDefault();
        this.collectionAndFolderMenu.show = false;
        this.collectionAndFolderMenu.x = e.clientX;
        this.collectionAndFolderMenu.y = e.clientY;
        this.actOnItem = row;
        this.$nextTick(() => {
          this.collectionAndFolderMenu.show = true;
        });
      }
    },
  },
});
</script>

<template>
  <v-card class="girder-data-browser-snippet">
    <girder-data-browser
      ref="girderBrowser"
      :location.sync="internalLocation"
      :selectable="selectable"
      :draggable="dragEnabled"
      :root-location-disabled="rootLocationDisabled"
      :value="value"
      :items-per-page="itemsPerPage"
      :items-per-page-options="itemsPerPageOptions"
      @update:itemsPerPage="$emit('update:itemsPerPage', $event)"
      @input="$emit('input', $event)"
      @selection-changed="$emit('selection-changed', $event)"
      @rowclick="$emit('rowclick', $event)"
      @row-right-click="rowRightClick"
      @drag="$emit('drag', $event)"
      @dragstart="$emit('dragstart', $event)"
      @dragend="$emit('dragend', $event)"
      @drop="$emit('drop', $event)"
    >
      <template #breadcrumb="props">
        <DataSharedBreadCrumb
          :location="props.location"
          :root-location-disabled="props.rootLocationDisabled"
          @crumbclick="props.changeLocation($event)"
        />
      </template><template #headerwidget>
        <slot name="headerwidget" />
        <v-dialog
          v-if="shouldShowUpload"
          v-model="uploaderDialog"
          max-width="800px"
        >
          <template #activator="{ on }">
            <v-btn
              class="ma-0"
              text="text"
              small="small"
              v-on="on"
            >
              <v-icon
                class="mdi-24px mr-1"
                left="left"
                color="accent"
              >
                $vuetify.icons.fileNew
              </v-icon>
              <span class="hidden-xs-only">Upload</span>
            </v-btn>
          </template>
          <girder-upload
            :dest="uploadDest"
            :pre-upload="preUpload"
            :post-upload="postUploadInternal"
            :multiple="uploadMultiple"
            :max-show="uploadMaxShow"
            :accept="uploadAccept"
          />
        </v-dialog>
        <v-dialog
          v-if="newFolderEnabled && !isRootLocation(internalLocation) && girderRest.user"
          v-model="newFolderDialog"
          max-width="800px"
        >
          <template #activator="{ on }">
            <v-btn
              class="ma-0"
              text="text"
              small="small"
              v-on="on"
            >
              <v-icon
                class="mdi-24px mr-1"
                left="left"
                color="accent"
              >
                $vuetify.icons.folderNew
              </v-icon>
              <span class="hidden-xs-only">New Folder</span>
            </v-btn>
          </template>
          <girder-upsert-folder
            :key="internalLocation._id"
            :location="internalLocation"
            :pre-upsert="preUpsert"
            :post-upsert="postUpsertInternal"
            @dismiss="newFolderDialog = false"
          />
        </v-dialog>
      </template>
      <template #row="props">
        <slot
          v-bind="props"
          name="row"
        />
      </template>
    </girder-data-browser>
    <v-menu
      v-model="collectionAndFolderMenu.show"
      :position-x="collectionAndFolderMenu.x"
      :position-y="collectionAndFolderMenu.y"
      absolute="absolute"
      offset-y="offset-y"
      dark="dark"
    >
      <v-list dense="dense">
        <v-list-item
          :disabled="!hasAccessPermission"
          @click="showAccessControlDialog = true"
        >
          <v-list-item-title>Access control</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
    <v-dialog
      v-model="showAccessControlDialog"
      max-width="700px"
      persistent="persistent"
      eager="eager"
      scrollable="scrollable"
    >
      <girder-access-control
        v-if="actOnItem"
        :model="actOnItem"
        :has-permission.sync="hasAccessPermission"
        @close="showAccessControlDialog = false"
        @model-access-changed="$refs.girderBrowser.refresh()"
      />
    </v-dialog>
  </v-card>
</template>
