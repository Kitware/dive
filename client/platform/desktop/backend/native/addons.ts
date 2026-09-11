import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import { parse } from 'csv-parse';
import type { Settings } from 'platform/desktop/constants';
import type {
  AddonCatalog, AddonInstallRequest, AddonJob, ViameAddon,
} from 'platform/desktop/addons';
import { observeChild } from './processManager';

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
    const current: AddonJob = {
      name: addon.name, installDir: catalog.installDir, running: true, log: '',
    };
    job = current;
    // The installer only uses Python's standard library; no shell/setup script
    // is required. Catalog names and paths remain separate argv entries.
    const child = observeChild(spawn(python, args, {
      cwd: catalog.installDir,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }));
    const append = (data: Buffer) => { current.log = (current.log + data.toString()).slice(-65536); };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error) => { current.running = false; current.error = error.message; });
    child.on('close', (code) => {
      current.running = false;
      if (code !== 0 && !current.error) current.error = `Installation failed (exit ${code}). See the output below.`;
    });
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
