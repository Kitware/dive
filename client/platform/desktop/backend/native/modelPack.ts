/* Sequential streaming bounds memory and open files for large model packs. */
/* eslint-disable no-await-in-loop, no-restricted-syntax */
import path from 'path';
import fs from 'fs-extra';
import { pipeline as streamPipeline } from 'stream/promises';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import type { Pipe } from 'dive-common/apispec';
import { PipelinesFolderName, Settings } from 'platform/desktop/constants';

const MAX_FILES = 100000;
const MAX_BYTES = 100 * 1024 ** 3;

/** Keep relative model references intact while removing known archive wrappers. */
export function modelPackPaths(names: string[]): Map<string, string> {
  const clean = names.flatMap((name) => {
    const normalized = name.replace(/\\/g, '/');
    const parts = normalized.replace(/\/$/, '').split('/');
    if (normalized.startsWith('/') || normalized.includes('\0')
        || parts.some((part) => part === '..' || part === '' || part.includes(':'))) {
      throw new Error(`Unsafe model archive path: ${name}`);
    }
    if (parts.includes('__MACOSX') || parts[parts.length - 1] === '.DS_Store') return [];
    return [[name, path.posix.normalize(normalized)]];
  });
  const candidates = ['configs/pipelines/', 'pipelines/', ''];
  const wrappers = [...new Set(clean.filter(([, name]) => name.includes('/')).map(([, name]) => name.split('/')[0]))].sort();
  wrappers.forEach((wrapper) => candidates.push(`${wrapper}/configs/pipelines/`, `${wrapper}/pipelines/`, `${wrapper}/`));
  const root = candidates.find((prefix) => clean.some(([, name]) => name.startsWith(prefix)
    && !name.slice(prefix.length).includes('/') && name.endsWith('.pipe')));
  if (root === undefined) throw new Error('The ZIP must contain at least one .pipe file in a supported model layout.');
  const result = new Map<string, string>();
  const seen = new Set<string>();
  clean.forEach(([original, name]) => {
    if (!name.startsWith(root)) return;
    const relative = name.slice(root.length);
    if (!relative) return;
    const key = relative.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate model archive path: ${relative}`);
    seen.add(key);
    result.set(original, relative);
  });
  result.forEach((relative) => {
    const parts = relative.split('/');
    parts.pop();
    while (parts.length) {
      if (seen.has(parts.join('/').toLowerCase())) throw new Error(`Conflicting model archive path: ${relative}`);
      parts.pop();
    }
  });
  return result;
}

async function openArchive(filename: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) reject(error || new Error('Unable to open ZIP')); else resolve(zip);
    });
  });
}

async function readEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    let total = 0;
    zip.on('error', reject);
    zip.on('entry', (entry: yauzl.Entry) => {
      total += entry.uncompressedSize;
      if (entries.length >= MAX_FILES || total > MAX_BYTES) {
        reject(new Error('Model archive exceeds the file count or uncompressed size limit.'));
        return;
      }
      // eslint-disable-next-line no-bitwise
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (![0, 0o100000, 0o040000].includes(type)) {
        reject(new Error('Model archives cannot contain symbolic links or special files.'));
        return;
      }
      entries.push(entry);
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.readEntry();
  });
}

export async function importModelPack(settings: Settings, filename: string): Promise<void> {
  if (settings.readonlyMode) throw new Error('Model import is disabled in read-only mode.');
  const root = path.join(settings.dataPath, PipelinesFolderName);
  await fs.ensureDir(root);
  const staging = await fs.mkdtemp(path.join(root, '.import-'));
  let zip: yauzl.ZipFile | undefined;
  try {
    zip = await openArchive(filename);
    const entries = (await readEntries(zip)).filter((entry) => !entry.fileName.endsWith('/'));
    const mapping = modelPackPaths(entries.map((entry) => entry.fileName));
    for (const entry of entries) {
      const relative = mapping.get(entry.fileName);
      if (relative) {
        const target = path.join(staging, relative);
        await fs.ensureDir(path.dirname(target));
        const source = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
          zip!.openReadStream(entry, (error, stream) => {
            if (error || !stream) reject(error || new Error('Unable to read ZIP entry')); else resolve(stream);
          });
        });
        await streamPipeline(source, fs.createWriteStream(target, { flags: 'wx' }));
      }
    }
    const base = path.basename(filename, path.extname(filename)).replace(/[^\p{L}\p{N}_ .-]/gu, '_').replace(/^[ .]+|[ .]+$/g, '') || 'Imported model';
    let name = base;
    let suffix = 2;
    while (await fs.pathExists(path.join(root, name))) {
      name = `${base} (${suffix})`;
      suffix += 1;
    }
    await fs.move(staging, path.join(root, name), { overwrite: false });
  } finally {
    zip?.close();
    await fs.remove(staging);
  }
}

/**
 * Unpack an archive as it is, every entry under destination. Used for the
 * pack `viame train` writes, whose layout is already the pipeline folder's.
 */
export async function extractModelPackTo(filename: string, destination: string): Promise<string[]> {
  let zip: yauzl.ZipFile | undefined;
  const written: string[] = [];
  try {
    zip = await openArchive(filename);
    const entries = (await readEntries(zip)).filter((entry) => !entry.fileName.endsWith('/'));
    for (const entry of entries) {
      const relative = entry.fileName.replace(/\\/g, '/');
      const parts = relative.split('/');
      if (relative.startsWith('/') || parts.some((p) => p === '..' || p === '' || p.includes(':'))) {
        throw new Error(`Unsafe model archive path: ${entry.fileName}`);
      }
      const target = path.join(destination, ...parts);
      await fs.ensureDir(path.dirname(target));
      const source = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
        zip!.openReadStream(entry, (error, stream) => {
          if (error || !stream) reject(error || new Error('Unable to read ZIP entry')); else resolve(stream);
        });
      });
      await streamPipeline(source, fs.createWriteStream(target));
      written.push(relative);
    }
  } finally {
    zip?.close();
  }
  return written;
}

export async function exportModelPack(settings: Settings, model: Pipe, destination: string): Promise<void> {
  const root = await fs.realpath(path.join(settings.dataPath, PipelinesFolderName));
  const folder = await fs.realpath(path.dirname(model.pipe));
  if (model.type !== 'trained' || path.dirname(folder) !== root) throw new Error('Select a trained model pack to export.');
  const output = path.resolve(destination);
  const relativeOutput = path.relative(folder, output);
  if (!relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput)) throw new Error('Save the ZIP outside the model pack.');
  // Enumerate first to reject links, rather than exporting files outside the pack.
  const files: string[] = [];
  async function collect(directory: string) {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name);
      const info = await fs.lstat(file);
      if (info.isSymbolicLink()) throw new Error('Model packs cannot contain symbolic links.');
      if (info.isDirectory()) await collect(file);
      else if (info.isFile()) files.push(file);
      else throw new Error('Model packs cannot contain special files.');
    }
  }
  await collect(folder);
  const temp = await fs.mkdtemp(path.join(path.dirname(output), '.dive-export-'));
  try {
    const archivePath = path.join(temp, 'model.zip');
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createWriteStream(archivePath);
      const archive = archiver('zip', { zlib: { level: 1 } });
      const fail = (error: Error) => { archive.abort(); stream.destroy(); reject(error); };
      stream.on('error', fail);
      archive.on('error', fail);
      archive.on('warning', fail);
      stream.on('close', resolve);
      archive.pipe(stream);
      files.forEach((file) => archive.file(file, { name: path.relative(folder, file).split(path.sep).join('/') }));
      archive.finalize().catch(fail);
    });
    await fs.move(archivePath, output, { overwrite: true });
  } finally {
    await fs.remove(temp);
  }
}
