<script lang="ts">
import {
  defineComponent, onBeforeMount, ref,
} from '@vue/composition-api';

import { getSettings, setSettings, Settings } from '../store/settings';
import { nvidiaSmi, validateSettings, getDefaultSettings } from '../api/main';

import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';

export default defineComponent({
  components: {
    BrowserLink,
    NavigationBar,
  },
  setup() {
    // null values indicate initialization has not completed
    const smi = ref(null as unknown);
    const smiCode = ref(null as number | null);
    const { arch, platform, version } = process;
    const settings = ref(null as Settings | null);
    const settingsAreValid = ref(true as boolean | string);

    onBeforeMount(async () => {
      settings.value = await getSettings(await getDefaultSettings());
      settingsAreValid.value = await validateSettings(settings.value);
      const { output, code } = await nvidiaSmi();
      smi.value = output;
      smiCode.value = code;
    });

    async function save() {
      settingsAreValid.value = await validateSettings(settings.value);
      setSettings(settings.value);
    }

    return {
      arch,
      platform,
      save,
      settings,
      settingsAreValid,
      smi,
      smiCode,
      version,
    };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container>
      <v-card v-if="settings">
        <v-card-title>Settings</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="settings.viamePath"
            label="VIAME Install Base Path"
            hint="download from https://viametoolkit.com"
            dense
            persistent-hint
          />
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
          v-if="smiCode !== null"
          dense
          text
          :type="smi ? 'success' : 'warning'"
          class="mx-4"
        >
          <span v-if="smi">You are using a supported GPU configuration</span>
          <span v-else>
            Could not reliably determine your GPU compatibility:  nvidia-smi not found.
          </span>
        </v-alert>
        <v-alert
          dense
          text
          class="mx-4"
          :type="settingsAreValid === true ? 'success' : 'warning'"
        >
          <span v-if="settingsAreValid === true">
            Kwiver initialization succeeded
          </span>
          <span v-else>
            Could not initialize kwiver: {{ settingsAreValid }}
          </span>
        </v-alert>
        <v-card-text>
          <div>Architecture: {{ arch }}</div>
          <div>Platform: {{ platform }}</div>
          <div>Node Version: {{ version }}</div>
          <template v-if="smi">
            <div>NVIDIA Driver Version: {{ smi['nvidia_smi_log']['driver_version']['_text'] }}</div>
            <div>CUDA Version: {{ smi['nvidia_smi_log']['cuda_version']['_text'] }}</div>
            <div>Detected GPUs: {{ smi['nvidia_smi_log']['attached_gpus']['_text'] }}</div>
          </template>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>
