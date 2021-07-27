<script lang="ts">
import { cloneDeep } from 'lodash';
import {
  computed, defineComponent, watch, toRef, ref, PropType,
} from '@vue/composition-api';
import { MediaTypes, FPSOptions } from 'dive-common/constants';

import { filterByGlob } from 'platform/desktop/sharedUtils';
import { MediaImportPayload } from 'platform/desktop/constants';
import { locateDuplicates } from 'platform/desktop/frontend/store/dataset';
import { useApi } from 'dive-common/apispec';
import Vue from 'vue';


export default defineComponent({
  name: 'ImportDialog',
  props: {
    importData: {
      type: Object as PropType<MediaImportPayload>,
      required: true,
    },
  },
  setup(props) {
    const argCopy = ref(cloneDeep(props.importData));
    const duplicates = ref(locateDuplicates(props.importData.jsonMeta));
    const showAdvanced = ref(false);

    watch(toRef(props, 'importData'), (val) => {
      duplicates.value = locateDuplicates(val.jsonMeta);
      argCopy.value = cloneDeep(val);
    });

    const filteredImages = computed(() => filterByGlob(
      argCopy.value.globPattern,
      argCopy.value.jsonMeta.originalImageFiles,
    ));

    const ready = computed(() => {
      if (argCopy.value.globPattern) {
        return filteredImages.value.length > 0;
      }
      return true;
    });

    const { openFromDisk } = useApi();
    const openUpload = async () => {
      const ret = await openFromDisk('annotation');
      if (!ret.canceled) {
        if (ret.filePaths?.length) {
          const path = ret.filePaths[0];
          Vue.set(argCopy.value, 'trackFileAbsPath', path);
        }
      }
    };

    return {
      argCopy,
      duplicates,
      filteredImages,
      ready,
      showAdvanced,
      MediaTypes,
      FPSOptions,
      openUpload,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="import-card"
    style="overflow-x: hidden;"
  >
    <v-card-title class="text-h5">
      Import new {{ MediaTypes[argCopy.jsonMeta.type] }}
    </v-card-title>
    <v-card-text>
      <v-alert
        v-if="duplicates.length"
        type="warning"
        outlined
        dense
      >
        <b>Found {{ duplicates.length }} possible duplicates</b>
        <p
          v-for="(duplicate, i) in duplicates"
          :key="duplicate.id"
          class="text-caption my-0"
        >
          {{ i + 1 }}: {{ duplicate.name }}, created on
          {{ (new Date(duplicate.createdAt)).toLocaleString() }}
        </p>
        <b>Cancel</b>
        to return to the dataset list.
        <br><b>Finish Import</b>
        to ignore the warning and create a new dataset.
      </v-alert>
      <v-alert
        v-if="argCopy.mediaConvertList.length"
        type="info"
        outlined
        dense
      >
        Found {{ argCopy.mediaConvertList.length }}
        item(s) in this dataset that will be automatically transcoded on import.
        Dataset will not be available until transcoding is complete.
      </v-alert>
      <v-row class="d-flex my-2 mt-7">
        <v-col cols="9">
          <v-text-field
            v-model="argCopy.jsonMeta.name"
            label="Name"
            placeholder="Name for this dataset"
            hint="Changing the name does not modify the data source directory."
            persistent-hint
            outlined
            dense
          />
        </v-col>
        <v-col cols="3">
          <v-select
            v-model="argCopy.jsonMeta.fps"
            :items="argCopy.jsonMeta.type === 'video'
              ? FPSOptions.filter((v) => v <= Math.round(argCopy.jsonMeta.originalFps))
              : FPSOptions
            "
            type="number"
            required
            outlined
            dense
            label="Annotation FPS"
            hint="downsampling rate"
            persistent-hint
            class="shrink"
          />
        </v-col>
      </v-row>
      <v-row
        v-if="!argCopy.jsonMeta.multiCam"
        class="d-flex my-2 mt-2"
      >
        <v-text-field
          :value="argCopy.trackFileAbsPath"
          show-size
          counter
          prepend-icon="mdi-file-table"
          label="Annotation File (Optional)"
          hint="Optional"
          @click="openUpload"
        />
      </v-row>
      <p class="mb-5">
        <span
          class="text-body-1"
          style="cursor: pointer;"
          @click="showAdvanced = !showAdvanced"
        >
          <v-icon
            class="pr-1"
            color="primary lighten-3"
          >
            {{ showAdvanced ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
          </v-icon>
          <span
            class="primary--text text--lighten-3"
          >
            <span v-if="!showAdvanced">
              Show advanced options
            </span>
            <span v-else>
              Hide advanced options
            </span>
          </span>
        </span>
      </p>
      <div v-if="showAdvanced">
        <v-text-field
          v-if="argCopy.jsonMeta.type === 'image-sequence'"
          v-model="argCopy.globPattern"
          label="Glob Filter Pattern"
          placeholder="Leave blank to use all images. example: *.png"
          hint="
            Used to filter input images. Multiple patterns should be separated with semicolon.
          "
          persistent-hint
          outlined
          dense
          class="mb-0"
        />
        <v-chip
          v-if="argCopy.globPattern"
          :color="filteredImages.length ? 'success' : 'error'"
          outlined
          class="ml-3"
        >
          "{{ argCopy.globPattern }}" matches {{ filteredImages.length }}
          out of {{ argCopy.jsonMeta.originalImageFiles.length }} images
        </v-chip>
        <p class="my-3">
          New Dataset Properties
        </p>
        <table class="key-value-table">
          <tr>
            <td>New ID</td>
            <td>
              <pre>{{ argCopy.jsonMeta.id }}</pre>
            </td>
          </tr>
          <tr v-if="argCopy.jsonMeta.type == 'video'">
            <td>Video</td>
            <td>{{ argCopy.jsonMeta.originalVideoFile }}</td>
          </tr>
          <tr>
            <td>Source Dir</td>
            <td>
              <pre>{{ argCopy.jsonMeta.originalBasePath }}</pre>
            </td>
          </tr>
          <tr>
            <td>Annotation FPS</td>
            <td>
              {{ argCopy.jsonMeta.fps }}
              <span
                v-if="argCopy.jsonMeta.type === 'video'"
                class="pl-2"
              >
                <b>Note</b> video downsampled annotation framerate is different than raw video FPS
              </span>
            </td>
          </tr>
          <tr v-if="argCopy.jsonMeta.type == 'video'">
            <td>Raw FPS</td>
            <td>
              {{ argCopy.jsonMeta.originalFps }}
            </td>
          </tr>
          <tr v-if="argCopy.jsonMeta.type == 'image-sequence'">
            <td>Image Count</td>
            <td>{{ argCopy.jsonMeta.originalImageFiles.length }}</td>
          </tr>
        </table>
      </div>
      <div class="d-flex flex-row mt-4">
        <v-spacer />
        <v-btn
          text
          outlined
          class="mr-5"
          @click="$emit('abort')"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!ready"
          @click="$emit('finalize-import', argCopy)"
        >
          Finish Import
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped lang="scss">
@import 'dive-common/components/styles/KeyValueTable.scss';
</style>
