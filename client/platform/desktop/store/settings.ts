import Vue from 'vue';
import Install from '@vue/composition-api';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

interface Settings {
  version: number;
  viamePath: string;
}

const SettingsCurrentVersion = 1;
const SettingsKey = 'desktop.settings';

// Type Guard https://www.typescriptlang.org/docs/handbook/advanced-types.html
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSettings(settings: any): settings is Settings {
  if (!settings.version || typeof settings.version !== 'number') {
    return false;
  }
  if (!settings.viamePath || typeof settings.viamePath !== 'string') {
    return false;
  }
  return true;
}

function getSettings(defaults: Settings): Settings {
  const settingsStr = window.localStorage.getItem(SettingsKey);
  try {
    if (settingsStr) {
      const maybeSettings = JSON.parse(settingsStr);
      if (isSettings(maybeSettings)) {
        return maybeSettings;
      }
      return defaults;
    }
  } catch (err) {
    return defaults;
  }
  return defaults;
}

async function setSettings(settings: Settings) {
  window.localStorage.setItem(SettingsKey, JSON.stringify(settings));
}

export {
  Settings,
  SettingsCurrentVersion,
  getSettings,
  setSettings,
};
