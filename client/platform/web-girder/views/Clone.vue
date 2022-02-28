<script lang="ts">
import {
  computed, defineComponent, Ref, ref, PropType,
} from '@vue/composition-api';
import { GirderFileManager, GirderModelType } from '@girder/components/src';
import useRequest from 'dive-common/use/useRequest';
import { RootlessLocationType } from 'platform/web-girder/store/types';
import { GirderMetadataStatic } from 'platform/web-girder/constants';
import { useGirderRest } from 'platform/web-girder/plugins/girder';
import { clone, getDataset } from 'platform/web-girder/api';


export default defineComponent({
  components: { GirderFileManager },

  props: {
    datasetId: {
      // datasetId shoud only be non-null if the dataset is cloneable
      type: String as PropType<string | null>,
      default: null,
    },
    revision: {
      type: Number,
      default: undefined,
    },
    buttonOptions: {
      type: Object,
      default: () => ({}),
    },
    menuOptions: {
      type: Object,
      default: () => ({}),
    },
  },

  setup(props, { root }) {
    const girderRest = useGirderRest();
    const source = ref(null as GirderMetadataStatic | null);
    const open = ref(false);
    const location: Ref<RootlessLocationType> = ref({
      _modelType: ('user' as GirderModelType),
      _id: girderRest.user._id,
    });
    const newName = ref('');

    const locationIsFolder = computed(() => (location.value._modelType === 'folder'));

    async function click() {
      if (props.datasetId) {
        source.value = (await getDataset(props.datasetId)).data;
        newName.value = `Clone of ${source.value.name}`;
        if (props.revision) {
          newName.value = `${newName.value} revision ${props.revision}`;
        }
        open.value = true;
      }
    }

    function setLocation(newLoc: RootlessLocationType) {
      if (!('meta' in newLoc && newLoc.meta.annotate)) {
        location.value = newLoc;
      }
    }

    const { request: _cloneRequest, error: cloneError, loading: cloneLoading } = useRequest();
    const doClone = () => _cloneRequest(async () => {
      if (!props.datasetId) {
        throw new Error('no source dataset');
      }
      const newDataset = await clone({
        folderId: props.datasetId,
        name: newName.value,
        parentFolderId: location.value._id,
        revision: props.revision,
      });
      root.$router.push({ name: 'viewer', params: { id: newDataset.data._id } });
    });

    return {
      cloneError,
      cloneLoading,
      location,
      locationIsFolder,
      newName,
      open,
      source,
      /* methods */
      click,
      doClone,
      setLocation,
    };
  },
});
</script>

<template>
  <v-dialog
    v-model="open"
    :max-width="800"
    :overlay-opacity="0.95"
  >
    <template #activator="{ attrs, on }">
      <v-tooltip
        v-bind="attrs"
        bottom
        open-delay="400"
        v-on="on"
      >
        <template #activator="{ on: ton, attrs: tattrs }">
          <v-btn
            v-bind="{ ...tattrs, ...buttonOptions }"
            :disabled="datasetId === null"
            v-on="{ ...ton, click }"
          >
            <v-icon>
              mdi-content-copy
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
              class="pl-1"
            >
              Clone
            </span>
            <v-spacer />
            <v-icon v-if="menuOptions.right">
              mdi-dock-window
            </v-icon>
          </v-btn>
        </template>
        <span>Create a clone of this data</span>
      </v-tooltip>
    </template>

    <v-card v-if="source">
      <template v-if="source.foreign_media_id">
        <v-card-title>
          This dataset is a clone
        </v-card-title>
        <v-card-text>
          This dataset was cloned from another.  It can be annotated and used
          for pipelines and training like a regular dataset, but its images
          or video are references to an external dataset.
          <router-link :to="{ name: 'viewer', params: { id: source.foreign_media_id } }">
            Open media source dataset.
          </router-link>
        </v-card-text>
      </template>
      <v-divider />
      <v-card-title>
        Create a new clone
      </v-card-title>
      <v-card-text>
        <v-alert
          v-if="revision"
          type="info"
        >
          Revision {{ revision }} selected.
        </v-alert>
        <v-alert
          v-if="cloneError"
          type="error"
          dismissible
        >
          {{ cloneError }}
        </v-alert>
        Create a copy of this dataset in your personal workspace.  You will be able
        to edit annotations and run pipelines on the clone.  This operation does not
        copy, but instead directly references the source media.
        <v-text-field
          v-model="newName"
          label="New clone name"
          class="mt-4"
          outlined
          dense
          block
        />
        <v-card
          outlined
          flat
        >
          <GirderFileManager
            new-folder-enabled
            root-location-disabled
            no-access-control
            :location="location"
            @update:location="setLocation"
          >
            <template #row="{item}">
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
        <v-btn
          depressed
          block
          color="primary"
          class="mt-4"
          :loading="cloneLoading"
          :disabled="!locationIsFolder || cloneLoading"
          @click="doClone"
        >
          <span v-if="!locationIsFolder">
            Choose a destination folder...
          </span>
          <span v-else-if="'name' in location">
            Clone into {{ location.name }}
          </span>
          <span v-else>
            Something went wrong
          </span>
        </v-btn>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
