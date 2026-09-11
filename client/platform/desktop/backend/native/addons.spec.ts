import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import type { Settings } from 'platform/desktop/constants';
import {
  getAddons, installAddon, markerPath, readAddonCatalog,
} from './addons';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('./processManager', () => ({ observeChild: (child: unknown) => child }));

let root: string;
let settings: Settings;
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough };
const csv = [
  'FISH, https://example.test/fish.zip, "Fish, model", abc, ALL-PLATFORMS, "PYTORCH, ONNX", models/fish.pt',
  'OLD, https://example.test/old.zip, Legacy pack, def, ALL-PLATFORMS, PYTORCH,',
  'LINUX, https://example.test/linux.zip, Linux pack, ghi, LINUX-ONLY, ONNX, models/linux.pt',
  'WINDOWS, https://example.test/win.zip, Windows pack, jkl, WINDOWS-ONLY, ONNX, models/win.pt',
].join('\n');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dive addons '));
  settings = { viamePath: root, readonlyMode: false } as Settings;
  await fs.outputFile(path.join(root, 'bin/download_viame_addons.csv'), csv);
  await fs.outputFile(path.join(root, 'configs/add_ons.py'), '# installer');
  child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  vi.mocked(spawn).mockReturnValue(child as never);
});
afterEach(async () => {
  child.emit('close', 0);
  vi.clearAllMocks();
  await fs.remove(root);
});

it('reads the shared CSV with quoted descriptions and dependency lists', async () => {
  const addons = await readAddonCatalog(root, 'linux');
  expect(addons.map((a) => a.name)).toEqual(['FISH', 'OLD', 'LINUX']);
  expect(addons[0]).toMatchObject({ description: 'Fish, model', requires: ['PYTORCH', 'ONNX'], status: 'not installed' });
  expect(addons[1].status).toBe('unknown');
  expect((await readAddonCatalog(root, 'win32')).map((a) => a.name)).toEqual(['FISH', 'OLD', 'WINDOWS']);
});

it('notices externally installed and removed marker files on each refresh', async () => {
  expect((await getAddons(settings)).addons[0].status).toBe('not installed');
  const marker = path.join(root, 'configs/pipelines/models/fish.pt');
  await fs.outputFile(marker, 'model');
  expect((await getAddons(settings)).addons[0].status).toBe('installed');
  await fs.remove(marker);
  expect((await getAddons(settings)).addons[0].status).toBe('not installed');
});

it.each(['../outside', '/outside', 'C:\\outside', '..\\outside'])('rejects marker paths outside pipelines: %s', (marker) => {
  expect(() => markerPath(root, marker)).toThrow('Invalid add-on marker');
});

it('lists packs when the VIAME installer is unavailable', async () => {
  await fs.remove(path.join(root, 'configs/add_ons.py'));
  expect((await getAddons(settings)).installerAvailable).toBe(false);
  await expect(installAddon(settings, { name: 'FISH' })).rejects.toThrow('Update VIAME');
  expect(spawn).not.toHaveBeenCalled();
});

it('delegates installation with separate argv, preserving paths with spaces', async () => {
  const archive = path.join(root, 'my pack $(literal).zip');
  await fs.writeFile(archive, 'archive');
  await installAddon(settings, { name: 'FISH', archive, force: true });
  const [, args, options] = vi.mocked(spawn).mock.calls[0];
  expect(args).toEqual(['-u', path.join(root, 'configs/add_ons.py'), '--install-dir', root,
    '--csv', path.join(root, 'bin/download_viame_addons.csv'), 'install', 'FISH', '--force', '--from-file', archive]);
  expect(options).toMatchObject({ shell: false, cwd: root });
  child.stdout.write('Installed model\n');
  child.emit('close', 0);
  expect((await getAddons(settings)).job).toMatchObject({ running: false, log: 'Installed model\n' });
});

it('rejects simultaneous installs and reports errors without losing the log', async () => {
  const results = await Promise.allSettled([installAddon(settings, { name: 'FISH' }), installAddon(settings, { name: 'OLD' })]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  child.stderr.write('checksum mismatch');
  child.emit('close', 1);
  expect((await getAddons(settings)).job).toMatchObject({ running: false, log: 'checksum mismatch', error: expect.stringContaining('failed') });
  await installAddon(settings, { name: 'OLD' });
  child.emit('error', new Error('Python unavailable'));
  expect((await getAddons(settings)).job?.error).toBe('Python unavailable');
});

it('requires reinstall intent for an existing pack and blocks read-only installs', async () => {
  await fs.outputFile(path.join(root, 'configs/pipelines/models/fish.pt'), 'existing');
  await expect(installAddon(settings, { name: 'FISH' })).rejects.toThrow('already installed');
  await expect(installAddon({ ...settings, readonlyMode: true }, { name: 'FISH', force: true })).rejects.toThrow('read-only');
  await expect(installAddon(settings, { name: '--all' })).rejects.toThrow('Unknown add-on');
  expect(spawn).not.toHaveBeenCalled();
});
