import fs from 'fs-extra';
import path from 'path';
import type { Settings } from 'platform/desktop/constants';
import { parseCompositeDatasetId } from 'dive-common/compositeDatasetId';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import {
  SingleCameraMode, remapCsvIds, associationCalibrationError, associationMulticamError,
  stereoAssociationPipeline, lastCsvFrame,
} from 'dive-common/singleCamera';
import { serializeFile } from '../serializers/viame';
import * as common from './common';

export async function prepareSingleCameraRun(settings: Settings, datasetId: string, mode: SingleCameraMode = 'separate') {
  if (mode !== 'associate' && mode !== 'separate') throw new Error('Invalid single-camera association mode.');
  const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
  const info = await common.getValidatedProjectDir(settings, parentId);
  const meta = await common.loadJsonConfig(info.datasetFileAbsPath);
  if (!meta.multiCam || Object.keys(meta.multiCam.cameras).length < 2) {
    if (mode === 'associate') throw new Error(associationMulticamError);
    return null;
  }
  const camera = cameraName || meta.multiCam.defaultDisplay;
  const cameras = orderedMultiCamCameraNames(meta.multiCam);
  if (!cameras.includes(camera)) throw new Error(`Unknown camera: ${camera}`);
  if (mode === 'associate') {
    if (meta.subType !== 'stereo' || cameras.length !== 2) throw new Error(associationMulticamError);
    if (!meta.multiCam.calibration || !await fs.pathExists(meta.multiCam.calibration)) {
      throw new Error(associationCalibrationError);
    }
  }
  return {
    parentId, camera, cameras, mode, calibration: meta.multiCam.calibration,
  };
}

/** Read the other cameras again at completion, so ID allocation uses current annotations. */
export async function finishSingleCameraRun(
  settings: Settings,
  context: NonNullable<Awaited<ReturnType<typeof prepareSingleCameraRun>>>,
  outputs: string[],
  workingDir: string,
  runAssociation: (directory: string) => Promise<void>,
): Promise<void> {
  async function ingest(datasetId: string, paths: string[], cameras?: Record<string, string>) {
    const { meta } = await common.ingestDataFiles(settings, datasetId, paths, cameras);
    if (meta.attributes) {
      await common.saveConfig(settings, context.parentId, { attributes: meta.attributes });
    }
  }
  const available = await Promise.all(outputs.map(async (file) => (
    await fs.pathExists(file) && (await fs.stat(file)).size ? file : null
  )));
  const candidates = available.filter((file): file is string => !!file);
  const populated = await Promise.all(candidates.map(async (file) => (
    lastCsvFrame(await fs.readFile(file, 'utf8')) >= 0 ? file : null
  )));
  const output = populated.filter((file): file is string => !!file).pop() || candidates.pop();
  if (!output) throw new Error('Pipeline produced no detection or track output.');
  const others = await Promise.all(context.cameras.filter((name) => name !== context.camera).map(async (name) => {
    const info = await common.getValidatedProjectDir(settings, `${context.parentId}/${name}`);
    return {
      name,
      annotations: await common.loadAnnotationFile(info.trackFileAbsPath),
      meta: await common.loadJsonConfig(info.datasetFileAbsPath),
    };
  }));
  let maximumId = -1;
  others.forEach(({ annotations }) => Object.values(annotations.tracks).forEach((track) => {
    maximumId = Math.max(maximumId, track.id);
  }));
  if (maximumId < 0 || lastCsvFrame(await fs.readFile(output, 'utf8')) < 0) {
    await ingest(`${context.parentId}/${context.camera}`, [output]);
    return;
  }
  if (context.mode === 'separate') {
    const csv = remapCsvIds(await fs.readFile(output, 'utf8'), maximumId);
    const safeOutput = path.join(workingDir, 'separate-camera.csv');
    await fs.writeFile(safeOutput, csv);
    await ingest(`${context.parentId}/${context.camera}`, [safeOutput]);
    return;
  }
  const directory = path.join(workingDir, 'association');
  await fs.ensureDir(directory);
  const side = context.cameras.indexOf(context.camera) + 1;
  await fs.copyFile(output, path.join(directory, `input${side}.csv`));
  await serializeFile(path.join(directory, `input${3 - side}.csv`), others[0].annotations, others[0].meta);
  const inputs = await Promise.all([1, 2].map((index) => fs.readFile(path.join(directory, `input${index}.csv`), 'utf8')));
  const lastFrame = Math.max(...inputs.map(lastCsvFrame));
  const calibrationName = `calibration${path.extname(context.calibration!)}`;
  await fs.copy(context.calibration!, path.join(directory, calibrationName));
  await fs.writeFile(path.join(directory, 'clock.ppm'), 'P3\n1 1\n255\n0 0 0\n');
  await fs.writeFile(path.join(directory, 'frames.txt'), `${path.join(directory, 'clock.ppm')}\n`.repeat(lastFrame + 1));
  await fs.writeFile(path.join(directory, 'associate.pipe'), stereoAssociationPipeline.replace('calibration.json', calibrationName));
  await runAssociation(directory);
  const paired = Object.fromEntries(context.cameras.map((name, index) => [name, path.join(directory, `associated${index + 1}.csv`)]));
  // Validate both outputs before importing either camera.
  await Promise.all(Object.values(paired).map(async (file) => {
    if (!await fs.pathExists(file) || lastCsvFrame(await fs.readFile(file, 'utf8')) < 0) {
      throw new Error('Stereo association did not produce annotations for both cameras.');
    }
  }));
  await ingest(context.parentId, [], paired);
}
