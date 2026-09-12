import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import type { Settings } from 'platform/desktop/constants';
import { runElevatedInstaller } from './addonsElevation';
import {
  cancelAddon, getAddons, installAddon, markerPath, readAddonCatalog,
} from './addons';

vi.mock('./addonsElevation', () => ({ runElevatedInstaller: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('./processManager', () => ({ observeChild: (child: unknown) => child }));

const originalPlatform = process.platform;
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
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.restoreAllMocks();
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
  expect((await getAddons(settings)).job).toMatchObject({ running: false, log: 'checksum mismatch\n', error: expect.stringContaining('failed') });
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

it('reads split progress records and keeps download and install progress separate', async () => {
  await installAddon(settings, { name: 'FISH' });
  child.stdout.write('VIAME_ADDON_PROG');
  child.stdout.write('RESS {"phase":"download","done":25,"total":100}\n');
  expect((await getAddons(settings)).job).toMatchObject({ phase: 'download', downloadProgress: 25, log: '' });
  child.stdout.write('VIAME_ADDON_PROGRESS {"phase":"verify"}\nVIAME_ADDON_PROGRESS {"phase":"install","done":40,"total":100}\n');
  expect((await getAddons(settings)).job).toMatchObject({ phase: 'install', installProgress: 40 });
  child.emit('close', 0);
  expect((await getAddons(settings)).job).toMatchObject({ phase: 'complete', downloadProgress: 100, installProgress: 100 });
});

it('keeps older installer progress indeterminate and surfaces download errors', async () => {
  await installAddon(settings, { name: 'FISH' });
  child.stdout.write('Downloading FISH\n');
  expect((await getAddons(settings)).job?.downloadProgress).toBeUndefined();
  child.stderr.write('error: FISH: HTTP Error 403: Forbidden\n');
  child.emit('close', 1);
  expect((await getAddons(settings)).job?.error).toContain('HTTP Error 403: Forbidden');
});

it('reports an unwritable installation without starting the installer on Unix', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.spyOn(fs, 'mkdtemp').mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
  await expect(installAddon(settings, { name: 'FISH' })).rejects.toThrow('Permission denied');
  expect(spawn).not.toHaveBeenCalled();
});

it('requests Windows elevation for an unwritable installation and reports canceled permission', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  vi.spyOn(fs, 'mkdtemp').mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
  vi.mocked(runElevatedInstaller).mockResolvedValueOnce(1223);
  await installAddon(settings, { name: 'FISH' });
  expect(runElevatedInstaller).toHaveBeenCalledOnce();
  expect(spawn).not.toHaveBeenCalled();
  expect((await getAddons(settings)).job?.error).toContain('permission was canceled');
});

it('retries a Windows permission failure through UAC without hiding a second failure', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  vi.mocked(runElevatedInstaller).mockImplementationOnce(async (_python, _args, _cwd, append) => {
    append(Buffer.from('error: HTTP Error 403: Forbidden\n'));
    return 1;
  });
  await installAddon(settings, { name: 'FISH' });
  child.stderr.write('PermissionError: [WinError 5] Access is denied\n');
  child.emit('close', 1);
  expect(runElevatedInstaller).toHaveBeenCalledOnce();
  expect((await getAddons(settings)).job).toMatchObject({ running: false, elevated: true, error: expect.stringContaining('Installation failed (exit 1). error: HTTP Error 403') });
});

it('requests cooperative cancellation and waits for rollback before marking canceled', async () => {
  await fs.outputFile(path.join(root, 'configs/add_ons.py'), '# VIAME_ADDON_CANCEL_FILE');
  expect(await installAddon(settings, { name: 'FISH' })).toMatchObject({ canCancel: true });
  const options = vi.mocked(spawn).mock.calls[0][2];
  const file = options?.env?.VIAME_ADDON_CANCEL_FILE as string;
  expect(await fs.pathExists(file)).toBe(false);
  expect(await cancelAddon()).toMatchObject({ running: true, cancelRequested: true });
  expect(await fs.pathExists(file)).toBe(true);
  await expect(installAddon(settings, { name: 'OLD' })).rejects.toThrow('already running');
  child.emit('close', 130);
  expect((await getAddons(settings)).job).toMatchObject({ running: false, cancelled: true });
  expect((await getAddons(settings)).job?.error).toBeUndefined();
  await vi.waitFor(async () => expect(await fs.pathExists(path.dirname(file))).toBe(false));
});

it('preserves rollback errors after cancellation and does not report a late request as canceled', async () => {
  await fs.outputFile(path.join(root, 'configs/add_ons.py'), '# VIAME_ADDON_CANCEL_FILE');
  await installAddon(settings, { name: 'FISH' });
  await cancelAddon();
  child.stderr.write('Installation rollback incomplete; backups retained\n');
  child.emit('close', 1);
  expect((await getAddons(settings)).job?.error).toContain('rollback incomplete');
  expect((await getAddons(settings)).job?.cancelled).toBeUndefined();
  await installAddon(settings, { name: 'FISH' });
  await cancelAddon();
  child.emit('close', 0);
  expect((await getAddons(settings)).job).toMatchObject({ phase: 'complete', running: false });
  expect((await getAddons(settings)).job?.cancelled).toBeUndefined();
});

it('refuses unsafe cancellation with an older installer', async () => {
  await installAddon(settings, { name: 'FISH' });
  await expect(cancelAddon()).rejects.toThrow('Update VIAME');
  expect((await getAddons(settings)).job?.running).toBe(true);
});

it('passes cancellation through Windows elevation', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  await fs.outputFile(path.join(root, 'configs/add_ons.py'), '# VIAME_ADDON_CANCEL_FILE');
  vi.spyOn(fs, 'mkdtemp').mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
  let finish: (code: number) => void = () => {};
  vi.mocked(runElevatedInstaller).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await installAddon(settings, { name: 'FISH' });
  const file = vi.mocked(runElevatedInstaller).mock.calls[0][4] as string;
  await cancelAddon();
  expect(await fs.pathExists(file)).toBe(true);
  finish(130);
  await vi.waitFor(async () => expect((await getAddons(settings)).job).toMatchObject({ cancelled: true, running: false }));
});
