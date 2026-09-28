import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import archiver from 'archiver';
import type { Pipe } from 'dive-common/apispec';
import { PipelinesFolderName, Settings } from 'platform/desktop/constants';
import { exportModelPack, importModelPack, modelPackPaths } from './modelPack';

const layouts: { name: string; files: string[]; expected: string[] }[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../../testutils/model-pack-layouts.json'), 'utf8'),
);

let temp: string;
let settings: Settings;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dive-model-test-'));
  settings = { dataPath: temp, readonlyMode: false } as Settings;
});
afterEach(async () => { await fs.remove(temp); });

async function makeZip(files: string[], destination: string) {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip');
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    files.forEach((file) => archive.append(`contents of ${file}`, { name: file }));
    archive.finalize().catch(reject);
  });
}

it.each(layouts)('imports $name layout with paths and contents intact', async ({ files, expected }) => {
  expect([...modelPackPaths(files).values()]).toEqual(expected);
  const source = path.join(temp, 'fish.zip');
  await makeZip(files, source);
  await importModelPack(settings, source);
  await Promise.all([...modelPackPaths(files)].map(async ([original, relative]) => {
    expect(await fs.readFile(path.join(temp, PipelinesFolderName, 'fish', relative), 'utf8')).toBe(`contents of ${original}`);
  }));
});

it.each([
  ['../escape.pipe'], ['/absolute.pipe'], ['C:/escape.pipe'],
  ['pack/../../escape.pipe'], ['pack\\..\\escape.pipe'],
  ['custom.pipe', 'CUSTOM.pipe'], ['custom.pipe', 'custom.pipe'],
  ['custom.pipe', 'models', 'models/weights.pt'], ['weights.pt'],
])('rejects unsafe or invalid paths: %j', (...names) => {
  expect(() => modelPackPaths(names)).toThrow();
});

it('round trips every pack file and imports a duplicate without overwriting', async () => {
  const folder = path.join(temp, PipelinesFolderName, 'fish');
  await fs.outputFile(path.join(folder, 'custom.pipe'), 'relativepath model = models/model.onnx');
  await fs.outputFile(path.join(folder, 'models/model.onnx'), Buffer.from([0, 1, 2, 255]));
  await fs.outputFile(path.join(folder, 'extra/labels.txt'), 'fish');
  const model = { name: 'fish', type: 'trained', pipe: path.join(folder, 'custom.pipe') } as Pipe;
  const zip = path.join(temp, 'fish.zip');
  await exportModelPack(settings, model, zip);
  await importModelPack(settings, zip);
  const copy = path.join(temp, PipelinesFolderName, 'fish (2)');
  expect(await fs.readFile(path.join(copy, 'custom.pipe'), 'utf8')).toBe('relativepath model = models/model.onnx');
  expect(await fs.readFile(path.join(copy, 'models/model.onnx'))).toEqual(Buffer.from([0, 1, 2, 255]));
  expect(await fs.readFile(path.join(copy, 'extra/labels.txt'), 'utf8')).toBe('fish');
});

it('rejects exports outside the model store and destinations inside a model', async () => {
  const folder = path.join(temp, PipelinesFolderName, 'fish');
  await fs.outputFile(path.join(folder, 'custom.pipe'), 'pipeline');
  const model = { name: 'fish', type: 'trained', pipe: path.join(folder, 'custom.pipe') } as Pipe;
  await expect(exportModelPack(settings, model, path.join(folder, 'fish.zip'))).rejects.toThrow('outside');
  await expect(exportModelPack(settings, { ...model, pipe: path.join(temp, 'custom.pipe') }, path.join(temp, 'out.zip'))).rejects.toThrow('trained model');
});

it('cleans staging after a rejected import and honors read-only mode', async () => {
  const source = path.join(temp, 'invalid.zip');
  await makeZip(['weights.pt'], source);
  await expect(importModelPack(settings, source)).rejects.toThrow('.pipe');
  expect(await fs.readdir(path.join(temp, PipelinesFolderName))).toEqual([]);
  await expect(importModelPack({ ...settings, readonlyMode: true }, source)).rejects.toThrow('read-only');
});
