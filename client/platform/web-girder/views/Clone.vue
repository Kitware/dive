<script lang="ts">
import {
  computed, defineComponent, Ref, ref, PropType,
} from '@vue/composition-api';
import { GirderFileManager, GirderModel } from '@girder/components/src';
import { withRestError } from 'platform/web-girder/utils';

import { clone } from '../api/viame.service';
import { useGirderRest } from '../plugins/girder';


export default defineComponent({
  components: { GirderFileManager },

  props: {
    source: {
      type: Object as PropType<GirderModel>,
      required: true,
    },
  },

  setup(props, { root }) {
    const girderRest = useGirderRest();
    const open = ref(false);
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    const location: Ref<GirderModel> = ref({
      _modelType: 'user',
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      _id: girderRest.user._id,
    });
    const newName = ref('');

    const canClone = computed(() => location.value._modelType === 'folder');

    async function click() {
      newName.value = `Clone of ${props.source.name}`;
      open.value = true;
    }

    const { func: doClone, error: cloneError } = withRestError(async () => {
      const newDataset = await clone({
        folderId: props.source._id,
        name: newName.value,
        parentFolderId: location.value._id,
      });
      root.$router.push({ name: 'viewer', params: { id: newDataset._id } });
    });

    return {
      canClone,
      cloneError,
      location,
      newName,
      open,
      /* methods */
      click,
      doClone,
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
          <v-chip
            v-bind="tattrs"
            color="white"
            outlined
            class="ml-2"
            v-on="{ ...ton, click }"
          >
            Clone
          </v-chip>
        </template>
        <span>Create a clone of this data</span>
      </v-tooltip>
    </template>

    <v-card>
      <template v-if="source.meta.foreign_media_id ">
        <v-card-title>
          This dataset is a clone
        </v-card-title>
        <v-card-text>
          This dataset was cloned from another.  It can be annotated and used
          for pipelines and training like a regular dataset, but its images
          or video are references to an external dataset.
          <router-link :to="{ name: 'viewer', params: { id: source.meta.foreign_media_id } }">
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
            :location.sync="location"
          />
        </v-card>
        <v-btn
          depressed
          block
          color="primary"
          class="mt-4"
          :disabled="!canClone"
          @click="doClone"
        >
          <span v-if="canClone">Clone into {{ location.name }}</span>
          <span v-else>Choose a destination folder...</span>
        </v-btn>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
