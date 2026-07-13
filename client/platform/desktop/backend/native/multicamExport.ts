/**
 * Multi-camera dataset export for the desktop backend.
 */

import npath from 'path';
import os from 'os';
import fs from 'fs-extra';
import { createWriteStream } from 'fs';
import archiver from 'archiver';

import { MultiType } from 'dive-common/constants';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import { buildPerCameraRegistrationFiles } from 'vue-media-annotator/alignedView/cameraRegistrationFiles';
import { ExportMulticamEverythingArgs, Settings } from 'platform/desktop/constants';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';
import * as dive from 'platform/desktop/backend/serializers/dive';

// eslint-disable-next-line import/no-cycle
import { getValidatedProjectDir, loadAnnotationFile, loadJsonMetadata } from './common';
import {
  findParentFolderCalibrationFile,
  getDatasetCalibrationExportPath,
} from './datasetCalibration';
import {
  loadEffectiveRegistration, referenceCameraName,
} from './cameraRegistration';

async function writeJsonFile(absPath: string, data: unknown): Promise<void> {
  await fs.writeFile(absPath, JSON.stringify(data, null, 2));
}

function buildExportMetaJson(meta: JsonMeta): Record<string, unknown> {
  const output: Record<string, unknown> = { ...meta };
  if (meta.type === 'image-sequence') {
    const files = meta.transcodedImageFiles?.length
      ? meta.transcodedImageFiles
      : meta.originalImageFiles?.map((filePath) => npath.basename(filePath)) ?? [];
    output.imageData = files.map((filename) => ({ filename }));
  } else if (meta.type === 'video') {
    const filename = meta.transcodedVideoFile || meta.originalVideoFile;
    if (filename) {
      output.video = { filename };
    }
  }
  return output;
}

async function writeDatasetExportContents(
  settings: Settings,
  destDir: string,
  datasetId: string,
  excludeBelowThreshold: boolean,
  typeFilter: Set<string>,
): Promise<void> {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const meta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const data = await loadAnnotationFile(projectDirInfo.trackFileAbsPath);
  const serializeOptions = {
    excludeBelowThreshold,
    header: true,
  };

  await fs.ensureDir(destDir);
  await fs.writeJSON(npath.join(destDir, 'meta.json'), buildExportMetaJson(meta), { spaces: 2 });
  await dive.serializeFile(
    npath.join(destDir, 'annotations.dive.json'),
    data,
    meta,
    typeFilter,
    serializeOptions,
  );
  await viameSerializers.serializeFile(
    npath.join(destDir, 'annotations.viame.csv'),
    data,
    meta,
    typeFilter,
    serializeOptions,
  );
}

async function zipDirectory(sourceDir: string, destZipPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

// eslint-disable-next-line import/prefer-default-export -- single RPC export helper
export async function exportMulticamEverything(
  settings: Settings,
  args: ExportMulticamEverythingArgs,
): Promise<string> {
  const parentId = args.id.split('/')[0];
  const parentDirInfo = await getValidatedProjectDir(settings, parentId);
  const parentMeta = await loadJsonMetadata(parentDirInfo.metaFileAbsPath);
  if (parentMeta.type !== MultiType || !parentMeta.multiCam) {
    throw new Error('Everything export is only available for multi-camera datasets.');
  }

  const cameraNames = orderedMultiCamCameraNames({
    cameras: parentMeta.multiCam.cameras,
    defaultDisplay: parentMeta.multiCam.defaultDisplay,
  });
  if (!cameraNames.length) {
    throw new Error('Multi-camera dataset does not list any cameras.');
  }

  const tempDir = await fs.mkdtemp(npath.join(os.tmpdir(), 'dive-export-'));
  try {
    const datasetDir = npath.join(tempDir, parentMeta.name);
    await fs.ensureDir(datasetDir);
    await fs.writeJSON(
      npath.join(datasetDir, 'multiCam.json'),
      parentMeta.multiCam,
      { spaces: 2 },
    );
    await writeDatasetExportContents(
      settings,
      datasetDir,
      parentId,
      args.exclude,
      args.typeFilter,
    );

    const calibrationPath = await getDatasetCalibrationExportPath(settings, parentId)
      ?? await findParentFolderCalibrationFile(parentDirInfo.basePath);
    if (calibrationPath && await fs.pathExists(calibrationPath)) {
      const calibrationName = parentMeta.multiCam.calibrationOriginalName
        ?? npath.basename(calibrationPath);
      await fs.copy(calibrationPath, npath.join(datasetDir, calibrationName));
    }

    // Regenerate the camera registration as its per-camera files so the
    // zip carries it even when only the import-time seed exists.
    const rigRegistration = await loadEffectiveRegistration(parentDirInfo.basePath, parentMeta);
    await Promise.all(
      buildPerCameraRegistrationFiles(rigRegistration, referenceCameraName(parentMeta)).map(
        (file) => writeJsonFile(npath.join(datasetDir, file.name), file.body),
      ),
    );

    for (let i = 0; i < cameraNames.length; i += 1) {
      const cameraName = cameraNames[i];
      // eslint-disable-next-line no-await-in-loop
      await writeDatasetExportContents(
        settings,
        npath.join(datasetDir, cameraName),
        `${parentId}/${cameraName}`,
        args.exclude,
        args.typeFilter,
      );
    }

    await zipDirectory(tempDir, args.path);
  } finally {
    await fs.remove(tempDir);
  }
  return args.path;
}
