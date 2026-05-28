import {
  describe, expect, it, beforeEach, vi,
} from 'vitest';

import {
  clearMulticamFileRegistry,
  getCalibrationFile,
  getLastCalibration,
  saveCalibration,
  stashCalibrationFile,
} from './multicamFileRegistry';

describe('multicamFileRegistry calibration', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    clearMulticamFileRegistry();
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
    });
  });

  it('resolves calibration by basename when stashed with a path-like key', () => {
    const file = new File(['{}'], 'stereo-cal.json', { type: 'application/json' });
    stashCalibrationFile('folder/stereo-cal.json', file);
    expect(getCalibrationFile('stereo-cal.json')).toBe(file);
    expect(getCalibrationFile('folder/stereo-cal.json')).toBe(file);
  });

  it('does not restore last calibration from localStorage without a session File', async () => {
    const file = new File(['{}'], 'cal.json', { type: 'application/json' });
    await saveCalibration('cal.json');
    clearMulticamFileRegistry();
    await expect(getLastCalibration()).resolves.toBeNull();
  });

  it('restores last calibration when the File is still in the registry', async () => {
    const file = new File(['{}'], 'cal.json', { type: 'application/json' });
    stashCalibrationFile('cal.json', file);
    await saveCalibration('cal.json');
    await expect(getLastCalibration()).resolves.toBe('cal.json');
  });
});
