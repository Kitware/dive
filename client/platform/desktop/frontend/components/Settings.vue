<script lang="ts">
import {
  defineComponent, onBeforeMount, ref,
} from '@vue/composition-api';

import { remote } from 'electron';
import { NvidiaSmiReply } from 'platform/desktop/constants';

import { settings, setSettings, validateSettings } from '../store/settings';
import { nvidiaSmi } from '../api';

import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';

export default defineComponent({
  components: {
    BrowserLink,
    NavigationBar,
  },
  setup() {
    // null values indicate initialization has not completed
    const smi = ref(null as NvidiaSmiReply | null);
    const localSettings = settings;
    const { arch, platform, version } = process;
    const settingsAreValid = ref(true as boolean | string);
    const gitHash = process.env.VUE_APP_GIT_HASH;

    onBeforeMount(async () => {
      settingsAreValid.value = await validateSettings(localSettings.value);
      smi.value = await nvidiaSmi();
    });

    async function openPath(name: 'viamePath' | 'dataPath') {
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: localSettings.value[name],
      });
      if (!result.canceled) {
        [localSettings.value[name]] = result.filePaths;
      }
    }

    async function save() {
      if (settings.value !== null) {
        settingsAreValid.value = false;
        settingsAreValid.value = await validateSettings(localSettings.value);
        setSettings(localSettings.value);
      }
    }

    return {
      arch,
      gitHash,
      platform,
      save,
      localSettings,
      settingsAreValid,
      smi,
      version,
      openPath,
    };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container>
      <v-card>
        <v-card-title>Settings</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="9">
              <v-text-field
                v-model="localSettings.viamePath"
                label="VIAME Install Base Path"
                hint="download from https://viametoolkit.com"
                dense
                persistent-hint
              />
            </v-col>
            <v-col>
              <v-btn
                large
                block
                color="primary"
                class="mb-6"
                @click="openPath('viamePath')"
              >
                Choose
                <v-icon class="ml-2">
                  mdi-folder-open
                </v-icon>
              </v-btn>
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="9">
              <v-text-field
                v-model="localSettings.dataPath"
                label="Project Data Storage Path"
                hint="project annotation and metadata goes here."
                dense
                persistent-hint
              />
            </v-col>
            <v-col>
              <v-btn
                large
                block
                color="primary"
                class="mb-6"
                @click="openPath('dataPath')"
              >
                Choose
                <v-icon class="ml-2">
                  mdi-folder-open
                </v-icon>
              </v-btn>
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-text>
          <v-btn
            color="primary"
            @click="save"
          >
            <v-icon class="mr-2">
              mdi-content-save
            </v-icon>
            Save
          </v-btn>
        </v-card-text>
        <v-card-title>Platform support</v-card-title>
        <v-card-subtitle>
          Not all checks must pass in order to use this application.
          Warnings are intended to help with debugging.
        </v-card-subtitle>
        <v-alert
          dense
          text
          :type="smi === null ? 'info' : smi.exitCode === 0 ? 'success' : 'warning'"
          class="mx-4"
        >
          <span v-if="smi === null">
            Checking GPU compatibility:
            <v-progress-linear
              indeterminate
              color="yellow darken-2"
            />
          </span>
          <span v-else-if="smi.exitCode === 0">
            You are using a supported GPU configuration
          </span>
          <span v-else>
            Could not reliably determine your GPU compatibility:  nvidia-smi not found.
          </span>
        </v-alert>
        <v-alert
          dense
          text
          class="mx-4"
          :type="settingsAreValid ===
            false ? 'info' : settingsAreValid === true ? 'success' : 'warning'"
        >
          <span v-if="settingsAreValid === false ">
            Checking for Kwiver
            <v-progress-linear
              indeterminate
              color="yellow darken-2"
            />
          </span>
          <span v-else-if="settingsAreValid === true">
            Kwiver initialization succeeded
          </span>
          <span v-else>
            Could not initialize kwiver: {{ settingsAreValid }}
          </span>
        </v-alert>
        <v-card-text>
          <div>
            Build Version:
            <browser-link
              :href="`https://github.com/VIAME/VIAME-Web`"
              display="inline"
            >
              {{ gitHash }}
            </browser-link>
          </div>
          <div>Architecture: {{ arch }}</div>
          <div>Platform: {{ platform }}</div>
          <div>Node Version: {{ version }}</div>
          <template v-if="smi !== null && smi.output !== null">
            <div>
              NVIDIA Driver Version:
              {{ smi.output.nvidia_smi_log.driver_version._text }}
            </div>
            <div>
              CUDA Version:
              {{ smi.output.nvidia_smi_log.cuda_version._text }}
            </div>
            <div>
              Detected GPUs:
              {{ smi.output.nvidia_smi_log.attached_gpus._text }}
            </div>
          </template>
        </v-card-text>
      </v-card>
      <div class="d-flex flex-row justify-end">
        <browser-link
          href="https://github.com/VIAME/VIAME-Web/issues/new?labels=bug&template=bug-report.md&title=%5BBUG%5D"
          class="ma-2"
        >
          🐛 Report a bug
        </browser-link>
        <browser-link
          href="https://github.com/VIAME/VIAME-Web/issues/new?labels=enhancement&template=feature-request.md&title=%5BFEATURE%5D"
          class="ma-2"
        >
          🚧 Feature Request
        </browser-link>
      </div>
    </v-container>
  </v-main>
</template>
