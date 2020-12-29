import type { Settings } from 'platform/desktop/constants';

let settings: Settings | undefined;

function get(): Settings {
  if (settings === undefined) {
    throw new Error('settings has not been initialized.');
  }
  return settings;
}

function set(s: Settings) {
  settings = s;
}

export default {
  get,
  set,
};
