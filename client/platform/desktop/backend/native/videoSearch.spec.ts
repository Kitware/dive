import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { DesktopJobUpdate, JobType, Settings } from 'platform/desktop/constants';
import linux from './linux';
import * as common from './common';
import { createCustomWorkingDirectory } from './utils';
import * as videoSearch from './videoSearch';

vi.mock('./linux', () => ({ default: { validateViamePath: vi.fn(), getViameConstants: () => ({ setupScriptAbs: 'setup', shell: '/bin/bash' }), getViamePythonExe: () => 'python3' } }));
vi.mock('./windows', () => ({ default: {} }));
vi.mock('./common', () => ({ getValidatedProjectDir: vi.fn(), loadJsonConfig: vi.fn() }));
vi.mock('./utils', () => ({
  createCustomWorkingDirectory: vi.fn(), jobFileEchoMiddleware: (job: DesktopJobUpdate, update: (value: DesktopJobUpdate) => void) => (data: Buffer) => update({ ...job, body: [data.toString()] }), getBinaryPath: vi.fn(), spawnResult: vi.fn(),
}));
vi.mock('./processManager', () => ({ observeChild: (child: unknown) => child }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));
let root: string;
let settings: Settings;
let updates: DesktopJobUpdate[];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dive-index-job-'));
  settings = { viamePath: root, dataPath: root } as Settings;
  updates = [];
  vi.mocked(linux.validateViamePath).mockResolvedValue(true);
  vi.mocked(common.getValidatedProjectDir).mockResolvedValue({ datasetFileAbsPath: 'meta' } as never);
  vi.mocked(common.loadJsonConfig).mockResolvedValue({
    type: 'video', originalBasePath: '/video', originalVideoFile: 'fish.mp4', fps: 30,
  } as never);
  vi.mocked(createCustomWorkingDirectory).mockResolvedValue(root);
});
afterEach(async () => { await fs.remove(root); vi.clearAllMocks(); });
const args = { type: JobType.BuildSearchIndex as const, datasetId: 'fish', method: 'detections' as const };
it('registers preparation immediately and keeps startup failures in history', async () => {
  vi.mocked(linux.validateViamePath).mockResolvedValue('Missing VIAME installation');
  const pending = videoSearch.buildIndex(settings, args, (update) => updates.push(update));
  expect(updates[0]).toMatchObject({
    jobType: 'indexing', pid: -1, datasetIds: ['fish'], exitCode: null,
  });
  const job = await pending;
  expect(job.exitCode).toBe(1);
  expect(job.endTime).toBeDefined();
  expect(updates.at(-1)?.body).toEqual(['ERROR: Missing VIAME installation']);
  expect(updates.at(-1)?.key).toBe(updates[0].key);
});
it('updates the same job with its process and finishes only after index metadata is saved', async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 123, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough(),
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  const job = await videoSearch.buildIndex(settings, args, (update) => updates.push(update));
  expect(updates.at(-1)).toMatchObject({ key: updates[0].key, pid: 123, workingDir: root });
  child.stdout.write('Extracting descriptors');
  child.stderr.write('Example diagnostic');
  expect(updates.flatMap((update) => update.body || [])).toContain('Extracting descriptors');
  expect(updates.flatMap((update) => update.body || [])).toContain('Example diagnostic');
  child.emit('close', 0);
  await vi.waitFor(() => expect(job.endTime).toBeDefined());
  expect(updates.at(-1)?.exitCode).toBe(0);
  expect(await fs.pathExists(path.join(root, 'DIVE_SearchIndex/index_meta.json'))).toBe(true);
});

it('indexes the first configured stereo camera and names it in the job log', async () => {
  vi.mocked(common.loadJsonConfig).mockResolvedValueOnce({
    multiCam: {
      cameras: { right: {}, left: {} }, cameraOrder: ['left', 'right'], defaultDisplay: 'right',
    },
  } as never);
  const child = Object.assign(new EventEmitter(), {
    pid: 124, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough(),
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  const job = await videoSearch.buildIndex(settings, args, (update) => updates.push(update));
  expect(common.getValidatedProjectDir).toHaveBeenLastCalledWith(settings, 'fish/left');
  expect(job.datasetIds).toEqual(['fish', 'fish/left']);
  expect(updates.flatMap((update) => update.body || [])).toContain('Indexing first camera: left (fish/left)');
  child.emit('close', 0);
  await vi.waitFor(() => expect(job.endTime).toBeDefined());
  const metadata = await fs.readJson(path.join(root, 'DIVE_SearchIndex/index_meta.json'));
  expect(Object.values(metadata.streams)).toEqual([expect.objectContaining({ datasetId: 'fish/left' })]);
});
