import Vue from 'vue';
import Install, { ref } from '@vue/composition-api';
import { ipcRenderer } from 'electron';

import { Settings } from '../constants';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

const SettingsKey = 'desktop.settings';

const settings = ref({} as Settings);

function getDefaultSettings(): Promise<Settings> {
  return ipcRenderer.invoke('default-settings');
}

function validateSettings(s: Settings): Promise<string | boolean> {
  return ipcRenderer.invoke('validate-settings', s);
}

// Type Guard https://www.typescriptlang.org/docs/handbook/advanced-types.html
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSettings(s: any): s is Settings {
  if (!s.version || typeof s.version !== 'number') {
    return false;
  }
  if (!s.viamePath || typeof s.viamePath !== 'string') {
    return false;
  }
  return true;
}

async function init() {
  const settingsStr = window.localStorage.getItem(SettingsKey);
  let settingsvalue = await getDefaultSettings();
  try {
    if (settingsStr) {
      const maybeSettings = JSON.parse(settingsStr);
      if (isSettings(maybeSettings)) {
        settingsvalue = maybeSettings;
      }
    }
  } catch {
    // pass
  }
  settings.value = settingsvalue;
}

async function setSettings(s: Settings) {
  window.localStorage.setItem(SettingsKey, JSON.stringify(s));
}

// Will be initialized on first import
init();

export {
  settings,
  setSettings,
  validateSettings,
};
