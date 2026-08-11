import mockfs from 'mock-fs';
import npath from 'path';
import fs from 'fs-extra';
import {
  afterEach, describe, expect, it,
} from 'vitest';

import { Settings, GlobalStyleSettingsFileName } from 'platform/desktop/constants';
import { loadGlobalStyleSettings, saveGlobalStyleSettings } from './globalStyles';

const settings: Settings = {
  version: 1,
  dataPath: '/home/user/viamedata',
  viamePath: '/opt/viame',
  readonlyMode: false,
  overrides: {},
};

const stylePath = npath.join(settings.dataPath, GlobalStyleSettingsFileName);

afterEach(() => {
  mockfs.restore();
});

describe('native.globalStyles', () => {
  it('returns empty overrides when no file exists', async () => {
    mockfs({ [settings.dataPath]: {} });
    const result = await loadGlobalStyleSettings(settings);
    expect(result).toEqual({});
  });

  it('returns empty overrides when the data directory is absent', async () => {
    mockfs({});
    const result = await loadGlobalStyleSettings(settings);
    expect(result).toEqual({});
  });

  it('round-trips saved type and group styling', async () => {
    mockfs({ [settings.dataPath]: {} });
    const styleSettings = {
      customTypeStyling: { seal: { color: '#ff0000', opacity: 0.5 } },
      customGroupStyling: { pod: { color: '#00ff00' } },
    };
    await saveGlobalStyleSettings(settings, styleSettings);
    const result = await loadGlobalStyleSettings(settings);
    expect(result).toEqual(styleSettings);
  });

  it('creates the data directory if it does not yet exist', async () => {
    mockfs({});
    await saveGlobalStyleSettings(settings, {
      customTypeStyling: { seal: { color: '#ff0000' } },
    });
    expect(await fs.pathExists(stylePath)).toBe(true);
    const result = await loadGlobalStyleSettings(settings);
    expect(result.customTypeStyling).toEqual({ seal: { color: '#ff0000' } });
    // Missing group styling normalizes to an empty object rather than undefined.
    expect(result.customGroupStyling).toEqual({});
  });

  it('normalizes missing keys to empty objects on save', async () => {
    mockfs({ [settings.dataPath]: {} });
    await saveGlobalStyleSettings(settings, {});
    const written = await fs.readJSON(stylePath);
    expect(written).toEqual({ customTypeStyling: {}, customGroupStyling: {} });
  });

  it('degrades to empty overrides when the stored file is corrupt', async () => {
    mockfs({ [stylePath]: 'not valid json {' });
    const result = await loadGlobalStyleSettings(settings);
    expect(result).toEqual({});
  });
});
