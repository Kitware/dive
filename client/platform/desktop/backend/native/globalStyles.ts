/**
 * Cross-dataset "shared" color/style overrides for the desktop backend.
 *
 * Desktop has no user accounts, so the shared color scope stores one set of
 * type/group style overrides per data directory (settings.dataPath) and reuses
 * it across every sequence. The file is a small JSON blob written next to the
 * DIVE_Projects folder.
 */

import npath from 'path';
import fs from 'fs-extra';

import { GlobalStyleSettings } from 'dive-common/apispec';
import { Settings, GlobalStyleSettingsFileName } from 'platform/desktop/constants';

function globalStylePath(settings: Settings): string {
  return npath.join(settings.dataPath, GlobalStyleSettingsFileName);
}

/**
 * Read the shared style overrides. Returns an empty object when the file is
 * absent or unreadable, so a fresh install (or a corrupt file) degrades to "no
 * shared overrides" rather than throwing.
 */
export async function loadGlobalStyleSettings(settings: Settings): Promise<GlobalStyleSettings> {
  const filePath = globalStylePath(settings);
  if (!(await fs.pathExists(filePath))) {
    return {};
  }
  try {
    const data = await fs.readJSON(filePath);
    return {
      customTypeStyling: data?.customTypeStyling ?? {},
      customGroupStyling: data?.customGroupStyling ?? {},
    };
  } catch {
    return {};
  }
}

/**
 * Persist the shared style overrides, creating the data directory if needed.
 */
export async function saveGlobalStyleSettings(
  settings: Settings,
  styleSettings: GlobalStyleSettings,
): Promise<void> {
  await fs.ensureDir(settings.dataPath);
  const payload: GlobalStyleSettings = {
    customTypeStyling: styleSettings.customTypeStyling ?? {},
    customGroupStyling: styleSettings.customGroupStyling ?? {},
  };
  await fs.writeFile(globalStylePath(settings), JSON.stringify(payload, null, 2));
}
