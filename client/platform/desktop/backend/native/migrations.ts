/* eslint-disable no-param-reassign */
import { JsonConfig, JsonConfigCurrentVersion } from 'platform/desktop/constants';

function upgrade(meta: JsonConfig) {
  if (meta.version === JsonConfigCurrentVersion) {
    /* Perform soft upgrades of backward-compatible properties */
    if (meta.originalFps === undefined) {
      // This will be an incorrect value.
      meta.originalFps = meta.fps;
    }
    if (meta.multiCam === undefined) {
      meta.multiCam = null;
    }
    if (meta.subType === undefined) {
      meta.subType = null;
    }
  } else if (meta.version < JsonConfigCurrentVersion) {
    /* Perform major version upgrade */
    console.error('Impossible schema', meta);
    throw new Error('Impossible schema revision detected.  This is not a valid DIVE project metadata file.  Check the console for details.');
  } else if (meta.version > JsonConfigCurrentVersion) {
    throw new Error('You are trying to open a newer version of the project schema.  Please upgrade DIVE to the latest version');
  }
  meta.version = JsonConfigCurrentVersion;
}

// eslint-disable-next-line import/prefer-default-export
export { upgrade };
