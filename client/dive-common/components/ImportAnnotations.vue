<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useHandler } from 'vue-media-annotator/provides';
import { getResponseError } from 'vue-media-annotator/utils';

export default defineComponent({
  name: 'ImportAnnotations',
  props: {
    datasetId: {
      type: String,
      default: null,
    },
    blockOnUnsaved: {
      type: Boolean,
      default: false,
    },
    buttonOptions: {
      type: Object,
      default: () => ({}),
    },
    menuOptions: {
      type: Object,
      default: () => ({}),
    },
    readOnlyMode: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const { openFromDisk, importAnnotationFile } = useApi();
    const { reloadAnnotations } = useHandler();
    const { prompt } = usePrompt();
    const processing = ref(false);
    const menuOpen = ref(false);
    const openUpload = async () => {
      try {
        const ret = await openFromDisk('annotation');
        if (!ret.canceled) {
          menuOpen.value = false;
          const path = ret.filePaths[0];
          let importFile = false;
          processing.value = true;
          if (ret.fileList?.length) {
            importFile = await importAnnotationFile(props.datasetId, path, ret.fileList[0]);
          } else {
            importFile = await importAnnotationFile(props.datasetId, path);
          }

          if (importFile) {
            processing.value = false;
            await reloadAnnotations();
          }
        }
      } catch (error) {
        const text = [getResponseError(error)];
        prompt({
          title: 'Import Failed',
          text,
          positiveButton: 'OK',
        });
        processing.value = false;
      }
    };
    return {
      openUpload,
      processing,
      menuOpen,
    };
  },
});
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    :nudge-width="120"
    v-bind="menuOptions"
    max-width="280"
  >
    <template #activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            class="ma-0"
            v-bind="buttonOptions"
            :disabled="!datasetId || processing"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <div>
              <v-icon>
                {{ processing ? 'mdi-spin mdi-sync' : 'mdi-application-import' }}
              </v-icon>
              <span
                v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
                class="pl-1"
              >
                Import
              </span>
            </div>
          </v-btn>
        </template>
        <span> Import Annotation Data </span>
      </v-tooltip>
    </template>
    <template>
      <v-card v-if="readOnlyMode">
        <v-card-title> Read only Mode</v-card-title>
        <v-card-text>
          This Dataset is in ReadOnly Mode.  You cannot import annotations for this dataset.
        </v-card-text>
      </v-card>
      <v-card
        v-else
        outlined
      >
        <v-card-title>
          Import Formats
        </v-card-title>
        <v-card-text>
          Multiple Data types can be imported:
          <ul>
            <li> Viame CSV Files </li>
            <li> DIVE Annotation JSON </li>
            <li> DIVE Configuation JSON</li>
            <li> KWCOCO JSON files </li>
          </ul>
          <a
            href="https://kitware.github.io/dive/DataFormats/"
            target="_blank"
          >Data Format Documentation</a>
        </v-card-text>
        <v-card-actions>
          <v-btn
            depressed
            block
            :disabled="!datasetId || processing"
            @click="openUpload"
          >
            Import
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-menu>
</template>
