import { ref, computed, toRaw } from 'vue';
import { Settings } from 'platform/desktop/constants';
import { cloneDeep } from 'lodash';
import * as semver from 'semver';

const SettingsKey = 'desktop.settings';
const VersionKey = 'desktop.currentVersion';

const settings = ref(null as Settings | null);
const currentVersion = window.diveDesktop.getAppVersionSync();
const knownVersion = ref(window.localStorage.getItem(VersionKey));

/**
 * upgradedVersion indicates that the currently launched instance
 * is an upgrade since the last time the user acknowledged an instnace of dive.
 */
const upgradedVersion = computed(() => {
  const known = knownVersion.value;
  if (known === null) {
    // all versions are greater than null
    return currentVersion;
  }
  if (known && semver.gt(currentVersion, known)) {
    return currentVersion;
  }
  return null;
});

/**
 * downgradedVersion indicates that the currently launched instance
 * is a downgrade of a previously acknowledged instance of dive.
 */
const downgradedVersion = computed(() => {
  const known = knownVersion.value;
  if (known && semver.lt(currentVersion, known)) {
    return currentVersion;
  }
  return null;
});

function getDefaultSettings(): Promise<Settings> {
  return window.diveDesktop.invoke('default-settings');
}

/** IPC uses structured clone; Vue reactive proxies cannot be cloned. */
function toIpcSettings(s: Settings): Settings {
  return cloneDeep(toRaw(s));
}

function validateSettings(s: Settings | null): Promise<string | boolean> {
  if (s === null) {
    return Promise.resolve(false);
  }
  return window.diveDesktop.invoke('validate-settings', toIpcSettings(s));
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
  const plainSettings = toIpcSettings(settingsValue);
  settings.value = plainSettings;
  window.diveDesktop.send('update-settings', plainSettings);
  return settings.value;
}

async function updateSettings(s: Settings) {
  const plainSettings = toIpcSettings(s);
  window.localStorage.setItem(SettingsKey, JSON.stringify(plainSettings));
  settings.value = plainSettings;
  window.diveDesktop.send('update-settings', plainSettings);
}

async function acknowledgeVersion() {
  window.localStorage.setItem(VersionKey, currentVersion);
  knownVersion.value = currentVersion;
}

// Will be initialized on first import
const initializedSettings = init();

export {
  settings,
  initializedSettings,
  upgradedVersion,
  downgradedVersion,
  knownVersion,
  acknowledgeVersion,
  updateSettings,
  validateSettings,
};
