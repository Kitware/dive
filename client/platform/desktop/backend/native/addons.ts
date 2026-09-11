import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import { parse } from 'csv-parse';
import type { Settings } from 'platform/desktop/constants';
import type {
  AddonCatalog, AddonInstallRequest, AddonJob, ViameAddon,
} from 'platform/desktop/addons';
import { observeChild } from './processManager';
import { runElevatedInstaller } from './addonsElevation';

const CSV_NAME = 'download_viame_addons.csv';
let job: AddonJob | null = null;
let starting = false;

/** The final CSV column is relative to configs/pipelines, as in VIAME add-ons. */
export function markerPath(installDir: string, marker: string): string {
  const normalized = marker.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)
      || normalized.split('/').includes('..')) throw new Error(`Invalid add-on marker: ${marker}`);
  return path.join(installDir, 'configs', 'pipelines', normalized);
}

export async function readAddonCatalog(installDir: string, platform = process.platform): Promise<ViameAddon[]> {
  const text = await fs.readFile(path.join(installDir, 'bin', CSV_NAME), 'utf8');
  const rows = await new Promise<string[][]>((resolve, reject) => {
    parse(text, { trim: true, skip_empty_lines: true, relax_column_count: true }, (error, records) => {
      if (error) reject(error); else resolve(records);
    });
  });
  const names = new Set<string>();
  const addons = rows.filter((row) => row.length >= 6)
    .filter((row) => !(row[4].trim() === 'LINUX-ONLY' && platform !== 'linux')
      && !(row[4].trim() === 'WINDOWS-ONLY' && platform !== 'win32'))
    .map((row): ViameAddon => {
      const [name, url, description, , , dependencies, marker = ''] = row.map((field) => field.trim());
      if (!name || names.has(name.toLowerCase())) throw new Error(`Invalid or duplicate add-on name: ${name}`);
      names.add(name.toLowerCase());
      return {
        name, url, description, marker, requires: dependencies.split(',').map((item) => item.trim()).filter(Boolean), status: 'unknown',
      };
    });
  // Check on every request, including add-ons installed outside DIVE.
  return Promise.all(addons.map(async (addon) => {
    if (addon.marker) {
      const status = (await fs.pathExists(markerPath(installDir, addon.marker))) ? 'installed' : 'not installed';
      return { ...addon, status } as ViameAddon;
    }
    return addon;
  }));
}

export async function getAddons(settings: Settings): Promise<AddonCatalog> {
  if (!settings.viamePath) throw new Error('Configure the VIAME installation in Settings first.');
  const installDir = path.resolve(settings.viamePath);
  return {
    installDir,
    addons: await readAddonCatalog(installDir),
    installerAvailable: await fs.pathExists(path.join(installDir, 'configs', 'add_ons.py')),
    readOnly: settings.readonlyMode,
    job: job ? { ...job } : null,
  };
}

const ELEVATION_REQUEST = 'Requesting administrator permission from Windows…\n';
const permissionFailure = (message: string) => /EACCES|EPERM|PermissionError|permission denied|access (?:is )?denied|WinError 5/i.test(message);

/** Probe actual writes, since Windows ACLs are not reliably represented by access(W_OK). */
async function checkWritable(installDir: string) {
  await Promise.all([installDir, path.join(installDir, 'configs', 'pipelines')].map(async (directory) => {
    if (!(await fs.pathExists(directory))) return;
    const probe = await fs.mkdtemp(path.join(directory, '.dive-write-check-'));
    await fs.remove(probe);
  }));
}

export function progressOutput(jobState: AddonJob) {
  const current = jobState;
  let pending = '';
  const line = (value: string) => {
    const prefix = 'VIAME_ADDON_PROGRESS ';
    if (value.startsWith(prefix)) {
      try {
        const event = JSON.parse(value.slice(prefix.length));
        if (['download', 'verify', 'install'].includes(event.phase)) {
          current.phase = event.phase;
          const percent = typeof event.done === 'number' && typeof event.total === 'number' && event.total > 0
            ? Math.max(0, Math.min(100, (100 * event.done) / event.total)) : undefined;
          if (event.phase === 'download') current.downloadProgress = percent;
          if (event.phase === 'install') current.installProgress = percent;
          if (event.phase === 'verify' && !current.localArchive) current.downloadProgress = 100;
          return;
        }
      } catch { /* Retain malformed output in the log for diagnosis. */ }
    }
    if (value.startsWith('Downloading ')) current.phase = 'download';
    if (value.startsWith('Installing ')) {
      current.phase = 'install';
      if (!current.localArchive) current.downloadProgress = 100;
    }
    current.log = (`${current.log + value}\n`).slice(-65536);
  };
  return {
    append(data: Buffer) {
      pending += data.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      lines.forEach(line);
      // Do not allow an installer that never writes a newline to grow memory indefinitely.
      if (pending.length > 65536) { line(pending.slice(-65536)); pending = ''; }
    },
    flush() { if (pending) line(pending); pending = ''; },
  };
}

/** Start one installation in the main process so navigating away does not stop it. */
export async function installAddon(settings: Settings, request: AddonInstallRequest): Promise<AddonJob> {
  if (starting || job?.running) throw new Error('An add-on installation is already running.');
  if (settings.readonlyMode) throw new Error('Add-on installation is disabled in read-only mode.');
  if (!request || typeof request.name !== 'string' || !request.name
      || (request.archive !== undefined && typeof request.archive !== 'string')
      || (request.force !== undefined && typeof request.force !== 'boolean')) throw new Error('Invalid add-on installation request.');
  starting = true;
  try {
    const catalog = await getAddons(settings);
    const addon = catalog.addons.find((item) => item.name === request.name);
    if (!addon || addon.name.startsWith('-')) throw new Error('Unknown add-on. Refresh the catalog and try again.');
    if (!catalog.installerAvailable) throw new Error('Update VIAME to a version that includes configs/add_ons.py.');
    if (addon.status === 'installed' && !request.force) throw new Error('This add-on is already installed. Use Reinstall to replace it.');
    const args = [
      '-u', path.join(catalog.installDir, 'configs', 'add_ons.py'),
      '--install-dir', catalog.installDir, '--csv', path.join(catalog.installDir, 'bin', CSV_NAME),
      'install', addon.name,
    ];
    if (request.force) args.push('--force');
    if (request.archive) {
      const archive = path.resolve(request.archive);
      if (!(await fs.stat(archive)).isFile()) throw new Error('Choose a downloaded ZIP file.');
      args.push('--from-file', archive);
    }
    const bundled = path.join(catalog.installDir, 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
    const fallback = process.platform === 'win32' ? 'python' : 'python3';
    const python = (await fs.pathExists(bundled)) ? bundled : fallback;
    let elevate = false;
    try { await checkWritable(catalog.installDir); } catch (error) {
      if (!permissionFailure(String(error))) throw error;
      if (process.platform !== 'win32') throw new Error('Permission denied: DIVE cannot write to this VIAME installation. Ask an administrator to grant write access or choose a writable installation in Settings.');
      elevate = true;
    }
    const current: AddonJob = {
      name: addon.name,
      installDir: catalog.installDir,
      running: true,
      log: '',
      phase: request.archive ? 'verify' : 'download',
      localArchive: !!request.archive,
    };
    job = current;
    const output = progressOutput(current);
    const failed = (error: Error) => { output.flush(); current.running = false; current.error = error.message; };
    const finish = (code: number | null) => {
      output.flush();
      current.running = false;
      if (current.error) return;
      if (code === 0) {
        current.phase = 'complete'; current.installProgress = 100;
        if (!current.localArchive) current.downloadProgress = 100;
      } else if (!current.error) {
        if (code === 1223) current.error = 'Administrator permission was canceled. Try again and approve the Windows permission prompt.';
        else {
          const attemptLog = current.log.split(ELEVATION_REQUEST).pop() || '';
          const details = attemptLog.trim().split('\n').slice(-8).join('\n');
          current.error = permissionFailure(details)
            ? `Permission denied while installing this pack. Check write access to ${current.installDir}.\n${details}`
            : `Installation failed (exit ${code ?? 'unknown'}). ${details || 'The installer could not be started or did not report a reason.'}`;
        }
      }
    };
    const elevated = () => {
      current.elevated = true; current.phase = 'elevation'; current.running = true;
      current.log += ELEVATION_REQUEST;
      runElevatedInstaller(python, args, catalog.installDir, output.append).then(finish, failed);
    };
    if (elevate) elevated();
    else {
      const child = observeChild(spawn(python, args, {
        cwd: catalog.installDir,
        shell: false,
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', VIAME_ADDON_PROGRESS: '1' },
      }));
      child.stdout?.on('data', output.append);
      child.stderr?.on('data', output.append);
      child.on('error', failed);
      child.on('close', (code) => {
        output.flush();
        if (code !== 0 && process.platform === 'win32' && !current.error && permissionFailure(current.log)
            && !/rollback incomplete/i.test(current.log)) elevated();
        else finish(code);
      });
    }
    return { ...current };
  } catch (error) {
    if (job?.running) {
      job.running = false;
      job.error = (error as Error).message;
    }
    throw error;
  } finally {
    starting = false;
  }
}
