import Vue from 'vue';
import Install, { ref } from '@vue/composition-api';
import { ipcRenderer } from 'electron';
import { Settings } from 'platform/desktop/constants';
import { cloneDeep } from 'lodash';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

const SettingsKey = 'desktop.settings';

const settings = ref(null as Settings | null);

function getDefaultSettings(): Promise<Settings> {
  return ipcRenderer.invoke('default-settings');
}

function validateSettings(s: Settings | null): Promise<string | boolean> {
  if (s === null) {
    return Promise.resolve(false);
  }
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

// Settings initialization involves a handoff between renderer and background.
// This function should be called at application startup.
async function init() {
  // Client asks for default settings and external force overrides from background
  let settingsValue = await getDefaultSettings();
  try {
    // Client applies user-configured settings from localstorage
    const settingsStr = window.localStorage.getItem(SettingsKey) || '{}';
    const maybeSettings = JSON.parse(settingsStr);
    // Remove any previously saved overrides so environment variables apply
    delete maybeSettings.overrides;

    if (isSettings(maybeSettings)) {
      settingsValue = {
        // Populate from defaults to include any missing properties
        ...settingsValue,
        // Overwrite with explicitly persisted settings
        ...maybeSettings,
      };
    }
  } catch {
    // pass
  }
  // Client applies external force overrides
  if (settingsValue.overrides.viamePath !== undefined) {
    settingsValue.viamePath = settingsValue.overrides.viamePath;
  }
  if (settingsValue.overrides.readonlyMode !== undefined) {
    settingsValue.readonlyMode = settingsValue.overrides.readonlyMode;
  }
  settings.value = settingsValue;
  ipcRenderer.send('update-settings', settings.value);
  return settings.value;
}

async function updateSettings(s: Settings) {
  window.localStorage.setItem(SettingsKey, JSON.stringify(s));
  ipcRenderer.send('update-settings', settings.value);
  settings.value = cloneDeep(s);
}

// Will be initialized on first import
const initializedSettings = init();

export {
  settings,
  initializedSettings,
  updateSettings,
  validateSettings,
};
