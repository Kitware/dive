import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import type { Settings, JsonConfig } from 'platform/desktop/constants';
import { finishSingleCameraRun, prepareSingleCameraRun } from './singleCameraPipeline';
import * as common from './common';

vi.mock('./common', () => ({
  getValidatedProjectDir: vi.fn(async (_settings, id) => ({ datasetFileAbsPath: id, trackFileAbsPath: id })),
  loadJsonConfig: vi.fn(),
  loadAnnotationFile: vi.fn(),
  ingestDataFiles: vi.fn(async () => ({ meta: {} })),
  saveConfig: vi.fn(),
}));

describe('single camera result processing', () => {
  const settings = {} as Settings;
  let directory: string;
  let meta: JsonConfig;
  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dive-single-camera-'));
    meta = {
      subType: 'stereo',
      multiCam: {
        cameras: { left: {}, right: {} },
        cameraOrder: ['left', 'right'],
        defaultDisplay: 'right',
        calibration: path.join(directory, 'rig.npz'),
      },
    } as unknown as JsonConfig;
    await fs.writeFile(meta.multiCam!.calibration!, 'calibration');
    vi.mocked(common.loadJsonConfig).mockResolvedValue(meta);
    vi.mocked(common.loadAnnotationFile).mockResolvedValue({ version: 2, tracks: { 800: { id: 800, features: [], confidencePairs: [['fish', 1]] } }, groups: {} } as never);
  });
  afterEach(async () => fs.remove(directory));

  it('validates stereo calibration before launching and resolves the default camera', async () => {
    expect(await prepareSingleCameraRun(settings, 'rig', 'associate')).toMatchObject({ camera: 'right' });
    meta.subType = 'multicam';
    await expect(prepareSingleCameraRun(settings, 'rig/right', 'associate')).rejects.toThrow('not implemented');
    meta.subType = 'stereo';
    meta.multiCam!.calibration = undefined;
    await expect(prepareSingleCameraRun(settings, 'rig/right', 'associate')).rejects.toThrow('calibration');
  });

  it('uses all other cameras, prefers detections over a header-only track file, and changes only the target', async () => {
    meta.subType = 'multicam';
    meta.multiCam!.cameras.third = {} as never;
    meta.multiCam!.cameraOrder!.push('third');
    vi.mocked(common.loadAnnotationFile).mockImplementation(async (id) => ({
      tracks: { track: { id: id.endsWith('third') ? 2000 : 800 } },
    } as never));
    const context = (await prepareSingleCameraRun(settings, 'rig/right', 'separate'))!;
    const detections = path.join(directory, 'detections.csv');
    const tracks = path.join(directory, 'tracks.csv');
    await fs.writeFile(detections, '2,image,0,1,2,3,4,1,-1\n2,image,1,1,2,3,4,1,-1\n');
    await fs.writeFile(tracks, '# empty tracks\n');
    const run = vi.fn();
    await finishSingleCameraRun(settings, context, [detections, tracks], directory, run);
    expect(await fs.readFile(path.join(directory, 'separate-camera.csv'), 'utf8')).toBe(
      '2001,image,0,1,2,3,4,1,-1\n2001,image,1,1,2,3,4,1,-1\n',
    );
    expect(run).not.toHaveBeenCalled();
    expect(common.ingestDataFiles).toHaveBeenCalledTimes(1);
    expect(vi.mocked(common.ingestDataFiles).mock.calls[0][1]).toBe('rig/right');
  });

  it('does not import either camera if association fails', async () => {
    const context = (await prepareSingleCameraRun(settings, 'rig/right', 'associate'))!;
    const output = path.join(directory, 'detections.csv');
    await fs.writeFile(output, '1,image,0,1,2,3,4,1,-1\n');
    const run = vi.fn(async (cwd: string) => {
      expect(await fs.readFile(path.join(cwd, 'input2.csv'), 'utf8')).toContain('1,image,0');
      expect(await fs.readFile(path.join(cwd, 'associate.pipe'), 'utf8')).toContain('calibration.npz');
      throw new Error('association failed');
    });
    await expect(finishSingleCameraRun(settings, context, [output], directory, run)).rejects.toThrow('association failed');
    expect(run).toHaveBeenCalledOnce();
    expect(common.ingestDataFiles).not.toHaveBeenCalled();
  });

  it('imports both associated outputs using the stored left/right order', async () => {
    const context = (await prepareSingleCameraRun(settings, 'rig/right', 'associate'))!;
    const output = path.join(directory, 'detections.csv');
    await fs.writeFile(output, '1,image,0,1,2,3,4,1,-1\n');
    const run = vi.fn(async (cwd: string) => {
      await fs.writeFile(path.join(cwd, 'associated1.csv'), '42,left,0,1,2,3,4,1,-1\n');
      await fs.writeFile(path.join(cwd, 'associated2.csv'), '42,right,0,1,2,3,4,1,-1\n');
    });
    await finishSingleCameraRun(settings, context, [output], directory, run);
    expect(common.ingestDataFiles).toHaveBeenCalledWith(settings, 'rig', [], {
      left: path.join(directory, 'association/associated1.csv'),
      right: path.join(directory, 'association/associated2.csv'),
    });
  });

  it('keeps original output IDs when the other camera has no tracks', async () => {
    vi.mocked(common.loadAnnotationFile).mockResolvedValue({ tracks: {}, groups: {}, version: 2 });
    const context = (await prepareSingleCameraRun(settings, 'rig/right', 'separate'))!;
    const output = path.join(directory, 'detections.csv');
    await fs.writeFile(output, '27,image,0,1,2,3,4,1,-1\n');
    await finishSingleCameraRun(settings, context, [output], directory, vi.fn());
    expect(common.ingestDataFiles).toHaveBeenCalledWith(settings, 'rig/right', [output], undefined);
  });
});
