import mockfs from 'mock-fs';
import { Console } from 'console';

// https://github.com/tschaub/mock-fs/issues/234
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const console = new Console(process.stdout, process.stderr);

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
  const fsNode = await import('node:fs');
  const existsByStat = (targetPath: import('node:fs').PathLike) => {
    try {
      fsNode.statSync(targetPath);
      return true;
    } catch {
      return false;
    }
  };

  const patchedDefault = {
    ...actual.default,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };

  return {
    ...actual,
    default: patchedDefault,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };
});

vi.mock('./mediaJobs', () => ({
  checkMedia: vi.fn(() => Promise.resolve({
    websafe: true,
    originalFpsString: '30/1',
    originalFps: 30,
    videoDimensions: { width: 1920, height: 1080 },
  })),
}));

// eslint-disable-next-line import/first
import scanStereoBatch from './stereoCollectImport';
// eslint-disable-next-line import/first
import beginMultiCamImport from './multiCamImport';

const frames = (count: number, prefix = 'frame') => {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    files[`${prefix}_${String(i).padStart(4, '0')}.png`] = '';
  }
  return files;
};

afterEach(() => {
  mockfs.restore();
});

describe('native.stereoCollectImport', () => {
  it('resolves left/right camera folders per collect', async () => {
    mockfs({
      '/survey': {
        fl01: { left: frames(3), right: frames(3) },
        fl02: { left: frames(2), right: frames(2) },
      },
    });
    const result = await scanStereoBatch('/survey');
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['left', 'right']);
    expect(result.collects.map((collect) => collect.name)).toEqual(['fl01', 'fl02']);
    expect(result.collects[0].importArgs?.sourceList.left.sourcePath)
      .toBe('/survey/fl01/left');
  });

  it('resolves marker suffixed camera folders', async () => {
    mockfs({
      '/survey': {
        fl01: { cam_L: frames(2), cam_R: frames(2) },
      },
    });
    const result = await scanStereoBatch('/survey');
    expect(result.collects[0].importArgs?.sourceList.left.sourcePath)
      .toBe('/survey/fl01/cam_L');
  });

  it('falls back to listing order for two unnamed camera folders', async () => {
    mockfs({
      '/survey': {
        fl01: { camA: frames(2), camB: frames(2) },
      },
    });
    const result = await scanStereoBatch('/survey');
    expect(result.collects[0].importArgs?.sourceList.left.sourcePath)
      .toBe('/survey/fl01/camA');
    expect(result.collects[0].warnings.join(' ')).toContain('do not identify sides');
  });

  it('errors when no left/right pair can be found', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(2), IR: frames(2), UV: frames(2) },
      },
    });
    const result = await scanStereoBatch('/survey');
    expect(result.collects[0].importArgs).toBeNull();
    expect(result.problems.join(' ')).toContain('No stereo datasets found');
  });

  it('pairs sibling videos in the root', async () => {
    mockfs({
      '/survey': {
        'dive01_left.mp4': '',
        'dive01_right.mp4': '',
        'dive02_L.mp4': '',
        'dive02_R.mp4': '',
      },
    });
    const result = await scanStereoBatch('/survey');
    expect(result.problems).toEqual([]);
    expect(result.collects.map((collect) => collect.name)).toEqual(['dive01', 'dive02']);
    expect(result.collects[0].importArgs?.type).toBe('video');
  });

  it('pairs sibling image folders in the root', async () => {
    mockfs({
      '/survey': {
        run_L: frames(4),
        run_R: frames(4),
      },
    });
    const result = await scanStereoBatch('/survey');
    expect(result.collects).toHaveLength(1);
    expect(result.collects[0].name).toBe('run');
    expect(result.collects[0].importArgs?.sourceList.right.sourcePath).toBe('/survey/run_R');
  });

  it('attaches a calibration file found next to the cameras', async () => {
    mockfs({
      '/survey': {
        'calibration.npz': '',
        fl01: { left: frames(2), right: frames(2) },
      },
    });
    const result = await scanStereoBatch('/survey');
    expect(result.collects[0].importArgs?.calibrationFile).toBe('/survey/calibration.npz');
  });

  it('produces args that import as a stereo dataset', async () => {
    mockfs({
      '/survey': {
        fl01: { left: frames(2), right: frames(2) },
      },
    });
    const result = await scanStereoBatch('/survey');
    const { importArgs } = result.collects[0];
    expect(importArgs).not.toBeNull();
    if (!importArgs) {
      return;
    }
    const imported = await beginMultiCamImport(importArgs);
    expect(imported.jsonConfig.name).toBe('fl01');
    expect(imported.jsonConfig.subType).toBe('stereo');
    expect(Object.keys(imported.jsonConfig.multiCam?.cameras ?? {})).toEqual(['left', 'right']);
    expect(imported.jsonConfig.multiCam?.defaultDisplay).toBe('left');
    expect(imported.jsonConfig.multiCam?.cameras.left.originalBasePath)
      .toBe('/survey/fl01/left');
  });

  it('imports a root level video pair as a stereo dataset', async () => {
    mockfs({
      '/survey': {
        'dive01_left.mp4': '',
        'dive01_right.mp4': '',
      },
    });
    const result = await scanStereoBatch('/survey');
    const { importArgs } = result.collects[0];
    expect(importArgs).not.toBeNull();
    if (!importArgs) {
      return;
    }
    const imported = await beginMultiCamImport(importArgs);
    expect(imported.jsonConfig.subType).toBe('stereo');
    expect(imported.jsonConfig.multiCam?.cameras.left.originalVideoFile)
      .toBe('dive01_left.mp4');
    expect(imported.jsonConfig.multiCam?.cameras.right.originalVideoFile)
      .toBe('dive01_right.mp4');
  });
});
