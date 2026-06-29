<script lang="ts">
import { defineComponent, ref } from 'vue';

import { loadMetadata } from '../api';
import { settings, initializedSettings } from '../store/settings';
import { buildDatasetSourceInfo } from '../utils/datasetSourcePaths';
import type { DatasetSourceInfo as SourceInfo } from '../utils/datasetSourcePaths';

export default defineComponent({
  props: {
    datasetId: {
      type: String,
      required: true,
    },
  },

  setup(props) {
    const dialog = ref(false);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const openPathError = ref<string | null>(null);
    const info = ref<SourceInfo | null>(null);

    async function loadInfo() {
      loading.value = true;
      error.value = null;
      try {
        await initializedSettings;
        const parentId = props.datasetId.split('/')[0];
        const meta = await loadMetadata(parentId);
        info.value = buildDatasetSourceInfo(meta, settings.value);
      } catch (err) {
        error.value = String(err);
        info.value = null;
      } finally {
        loading.value = false;
      }
    }

    function openDialog() {
      dialog.value = true;
      loadInfo();
    }

    async function openPath(path: string) {
      if (!path) {
        return;
      }
      openPathError.value = null;
      try {
        const result = await window.diveDesktop.openPath(path);
        if (result) {
          openPathError.value = result;
        }
      } catch (err) {
        openPathError.value = String(err);
      }
    }

    return {
      dialog,
      loading,
      error,
      openPathError,
      info,
      openDialog,
      openPath,
    };
  },
});
</script>

<template>
  <span class="dataset-source-info">
    <v-tooltip bottom>
      <template #activator="{ on, attrs }">
        <v-btn
          icon
          small
          v-bind="attrs"
          class="dataset-source-info-btn"
          aria-label="Dataset source locations"
          v-on="on"
          @click.stop="openDialog"
        >
          <v-icon
            small
            color="grey lighten-1"
          >
            mdi-information-outline
          </v-icon>
        </v-btn>
      </template>
      <span>Dataset source locations</span>
    </v-tooltip>

    <v-dialog
      v-model="dialog"
      max-width="720"
    >
      <v-card outlined>
        <v-card-title class="text-h6">
          Dataset Locations
          <span
            v-if="info"
            class="text-subtitle-2 grey--text pl-2"
          >
            {{ info.datasetName }}
          </span>
        </v-card-title>
        <v-card-text>
          <div
            v-if="loading"
            class="py-4 text-center"
          >
            <v-progress-circular
              indeterminate
              color="primary"
            />
          </div>
          <v-alert
            v-else-if="error"
            type="error"
            dense
            text
          >
            {{ error }}
          </v-alert>
          <v-alert
            v-if="openPathError"
            type="warning"
            dense
            text
            class="mb-2"
          >
            {{ openPathError }}
          </v-alert>
          <table
            v-if="info && !loading && !error"
            class="key-value-table"
          >
            <tr>
              <td>Project Directory</td>
              <td>
                <pre class="path-text">{{ info.projectDirectory }}</pre>
                <span
                  class="open-link"
                  @click="openPath(info.projectDirectory)"
                >
                  <span class="text-decoration-underline">show in file manager</span>
                  <v-icon
                    small
                    class="mx-1"
                  >
                    mdi-folder-open
                  </v-icon>
                </span>
              </td>
            </tr>
            <tr v-if="info.mediaSource">
              <td>{{ info.mediaSource.label }}</td>
              <td>
                <pre class="path-text">{{ info.mediaSource.path }}</pre>
                <span
                  class="open-link"
                  @click="openPath(info.mediaSource.path)"
                >
                  <span class="text-decoration-underline">show in file manager</span>
                  <v-icon
                    small
                    class="mx-1"
                  >
                    mdi-folder-open
                  </v-icon>
                </span>
              </td>
            </tr>
            <tr v-if="info.sourceFolder">
              <td>{{ info.sourceFolder.label }}</td>
              <td>
                <pre class="path-text">{{ info.sourceFolder.path }}</pre>
                <span
                  class="open-link"
                  @click="openPath(info.sourceFolder.path)"
                >
                  <span class="text-decoration-underline">show in file manager</span>
                  <v-icon
                    small
                    class="mx-1"
                  >
                    mdi-folder-open
                  </v-icon>
                </span>
              </td>
            </tr>
            <tr
              v-for="camera in info.cameraSourceFolders"
              :key="camera.name"
            >
              <td>{{ camera.name }} Source Media</td>
              <td>
                <pre class="path-text">{{ camera.path }}</pre>
                <span
                  class="open-link"
                  @click="openPath(camera.path)"
                >
                  <span class="text-decoration-underline">show in file manager</span>
                  <v-icon
                    small
                    class="mx-1"
                  >
                    mdi-folder-open
                  </v-icon>
                </span>
              </td>
            </tr>
            <tr v-if="info.sourceCalibration">
              <td>Source Calibration</td>
              <td>
                <pre class="path-text">{{ info.sourceCalibration }}</pre>
                <span
                  class="open-link"
                  @click="openPath(info.sourceCalibration)"
                >
                  <span class="text-decoration-underline">show in file manager</span>
                  <v-icon
                    small
                    class="mx-1"
                  >
                    mdi-folder-open
                  </v-icon>
                </span>
              </td>
            </tr>
          </table>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            @click="dialog = false"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </span>
</template>

<style scoped lang="scss">
@import 'dive-common/components/styles/KeyValueTable.scss';

.dataset-source-info {
  display: inline-flex;
  vertical-align: middle;
}

.dataset-source-info-btn {
  margin-top: -2px;
}

.path-text {
  margin: 0 0 4px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 12px;
}

.open-link {
  color: var(--v-primary-lighten3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
</style>
