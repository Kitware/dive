<script lang="ts">
import {
  defineComponent, onBeforeMount, ref, computed, set, watch,
} from 'vue';

import { dialog, app } from '@electron/remote';

import { useRequest } from 'dive-common/use';
import { NvidiaSmiReply } from 'platform/desktop/constants';
import { cloneDeep, isEqual } from 'lodash';

import { autoDiscover } from '../store/dataset';
import { settings, updateSettings, validateSettings } from '../store/settings';
import { nvidiaSmi } from '../api';

import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';

export default defineComponent({
  components: {
    BrowserLink,
    NavigationBar,
  },
  setup() {
    const { arch, platform, version } = process;
    const gitHash = process.env.VUE_APP_GIT_HASH;
    const appversion = app.getVersion();

    // local copy of the global settings
    const localSettings = ref(cloneDeep(settings.value));

    // null values indicate initialization has not completed
    const smi = ref(null as NvidiaSmiReply | null);
    const settingsAreValid = ref(false as boolean | string);
    const viameOverride = computed(() => settings.value?.overrides?.viamePath);
    const readonlyMode = computed(() => settings.value?.readonlyMode);
    const pendingChanges = computed(() => isEqual(localSettings.value, settings.value));
    const autoDiscoverState = useRequest();
    const doAutodiscover = () => autoDiscoverState.request(autoDiscover);

    onBeforeMount(async () => {
      settingsAreValid.value = await validateSettings(localSettings.value);
      smi.value = await nvidiaSmi();
    });

    watch([settings], async () => {
      localSettings.value = cloneDeep(settings.value);
      settingsAreValid.value = await validateSettings(localSettings.value);
    });

    async function openPath(name: 'viamePath' | 'dataPath') {
      const defaultPath = localSettings.value?.[name];
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath,
      });
      if (localSettings.value === null) {
        throw new Error('Local settings not yet initialized.');
      }
      if (!result.canceled && defaultPath !== undefined) {
        set(localSettings.value, name, result.filePaths[0]);
      }
    }
    async function save() {
      if (localSettings.value !== null) {
        settingsAreValid.value = false;
        settingsAreValid.value = await validateSettings(localSettings.value);
        updateSettings(localSettings.value);
      }
    }

    return {
      appversion,
      arch,
      autoDiscoverState,
      gitHash,
      platform,
      settings,
      localSettings,
      settingsAreValid,
      smi,
      version,
      viameOverride,
      readonlyMode,
      pendingChanges,
      doAutodiscover,
      openPath,
      save,
    };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container>
      <v-card v-if="localSettings">
        <v-card-title>Settings</v-card-title>

        <v-card-text>
          <v-row>
            <v-col cols="9">
              <v-text-field
                v-model="localSettings.viamePath"
                label="VIAME Install Base Path"
                hint="download from https://viametoolkit.com"
                dense
                outlined
                :disabled="!!viameOverride"
                persistent-hint
              />
            </v-col>

            <v-col cols="3">
              <v-btn
                block
                color="primary"
                :disabled="!!viameOverride"
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
                outlined
                persistent-hint
              />
            </v-col>

            <v-col class="my-0">
              <v-btn
                block
                color="primary"
                @click="openPath('dataPath')"
              >
                Choose
                <v-icon class="ml-2">
                  mdi-folder-open
                </v-icon>
              </v-btn>
            </v-col>
          </v-row>

          <v-row>
            <v-col>
              <v-switch
                v-model="localSettings.readonlyMode"
                :disabled="!settingsAreValid"
                color="primary"
                :label="'Read only mode'"
                hide-details
                class="my-0"
              />
            </v-col>
          </v-row>

          <v-row>
            <v-col>
              <v-switch
                v-model="localSettings.nativeVideoPlayback"
                color="primary"
                label="Native video playback (experimental)"
                hide-details
                class="my-0"
              />
              <div class="text-caption grey--text mt-1">
                When enabled, videos will be played using on-demand frame extraction instead of
                being transcoded to MP4. This saves disk space and allows faster initial access,
                but playback may be slower for smooth video review.
                Best for frame-by-frame annotation work.
              </div>
            </v-col>
          </v-row>
        </v-card-text>

        <v-card-text>
          <v-btn
            color="primary"
            :disabled="pendingChanges || !settingsAreValid"
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
          v-if="!!viameOverride"
          dense
          text
          class="mx-4"
          :type="'info'"
        >
          VIAME install path environment variable detected, locking changes
        </v-alert>

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
            Could not determine your GPU compatibility: {{ smi.error }}
          </span>
        </v-alert>

        <v-alert
          dense
          text
          class="mx-4"
          :type="settingsAreValid
            === false ? 'info' : settingsAreValid === true ? 'success' : 'warning'"
        >
          <span v-if="settingsAreValid === false">
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

        <v-alert
          v-if="readonlyMode"
          dense
          text
          class="mx-4"
          :type="'warning'"
        >
          Read only mode is on
        </v-alert>

        <v-card-title>Synchronize Recents</v-card-title>
        <v-card-subtitle v-if="settings">
          Scan project directory (<b><u>{{ settings.dataPath }}</u></b>) to rediscover
          datasets and update Recents page.  This is useful if you've manually deleted or moved
          dataset folders around.  DIVE Desktop stores annotation files, metadata, and possibly
          trancoded copies of your source media here.
          <browser-link
            display="inline"
            href="https://kitware.github.io/dive/Dive-Desktop"
          >
            Check the docs for more info about the Project Data Storage Path.
          </browser-link>
        </v-card-subtitle>
        <v-btn
          text
          outlined
          class="mx-4"
          :disabled="autoDiscoverState.loading.value"
          @click="doAutodiscover"
        >
          <v-icon
            v-if="autoDiscoverState.loading.value || autoDiscoverState.count.value === 0"
            class="pr-2"
          >
            mdi-sync {{ autoDiscoverState.loading.value ? 'mdi-spin' : '' }}
          </v-icon>
          <v-icon
            v-else-if="autoDiscoverState.count.value > 0"
            color="success"
            class="pr-2"
          >
            mdi-check-circle
          </v-icon>
          Sync library with Project Data
        </v-btn>

        <v-card-text>
          <div>
            Application Version:
            <browser-link
              href="https://github.com/Kitware/dive/releases"
              display="inline"
            >
              {{ appversion }}
            </browser-link>
          </div>
          <div>
            Build Commit:
            <browser-link
              :href="`https://github.com/Kitware/dive/commit/${gitHash}`"
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
          href="https://github.com/Kitware/dive/issues/new?labels=bug&template=bug-report.md&title=%5BBUG%5D"
          class="ma-2"
        >
          🐛 Report a bug
        </browser-link>
        <browser-link
          href="https://github.com/Kitware/dive/issues/new?labels=enhancement&template=feature-request.md&title=%5BFEATURE%5D"
          class="ma-2"
        >
          🚧 Feature Request
        </browser-link>
      </div>
    </v-container>
  </v-main>
</template>
