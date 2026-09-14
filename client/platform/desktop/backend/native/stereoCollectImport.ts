/**
 * Batch stereo import scanner (desktop filesystem backend).
 */
import npath from 'path';
import fs from 'fs-extra';
import { CollectSubfolderScan } from 'dive-common/multiCamBatchScan';
import {
  StereoBatchRawScan,
  StereoCollectRawScan,
  StereoVideoScan,
  scanStereoBatchFromScan,
} from 'dive-common/stereoBatchScan';
import {
  findImagesInFolder,
  isVideoFilePath,
  listImmediateSubfolders,
} from './common';
import { findParentFolderCalibrationFile } from './datasetCalibration';

async function listVideoFiles(folderPath: string): Promise<StereoVideoScan[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .filter((entry) => isVideoFilePath(entry.name))
    .map((entry) => ({ name: entry.name, path: npath.join(folderPath, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function scanCollectSubfolders(collectPath: string) {
  const subfolderNames = await listImmediateSubfolders(collectPath);
  const subfolders = new Map<string, CollectSubfolderScan>();
  for (let i = 0; i < subfolderNames.length; i += 1) {
    const folderName = subfolderNames[i];
    const subfolderPath = npath.join(collectPath, folderName);
    // eslint-disable-next-line no-await-in-loop
    const entryCount = (await fs.readdir(subfolderPath)).length;
    // eslint-disable-next-line no-await-in-loop
    const found = await findImagesInFolder(subfolderPath);
    subfolders.set(folderName.toLowerCase(), {
      folderName,
      path: subfolderPath,
      entryCount,
      imageCount: found.imagePaths.length,
    });
  }
  return subfolders;
}

async function scanStereoBatch(rootPath: string) {
  const collectNames = (await listImmediateSubfolders(rootPath))
    .sort((a, b) => a.localeCompare(b));

  const collects: StereoCollectRawScan[] = [];
  for (let i = 0; i < collectNames.length; i += 1) {
    const name = collectNames[i];
    const collectPath = npath.join(rootPath, name);
    collects.push({
      name,
      path: collectPath,
      // eslint-disable-next-line no-await-in-loop
      subfolders: await scanCollectSubfolders(collectPath),
      // eslint-disable-next-line no-await-in-loop
      videoFiles: await listVideoFiles(collectPath),
      // Images directly here make this folder one camera of a root level pair.
      // eslint-disable-next-line no-await-in-loop
      imageCount: (await findImagesInFolder(collectPath)).imagePaths.length,
      // eslint-disable-next-line no-await-in-loop
      calibrationFile: await findParentFolderCalibrationFile(collectPath),
    });
  }

  const raw: StereoBatchRawScan = {
    rootPath,
    collects,
    rootVideoFiles: await listVideoFiles(rootPath),
    rootCalibrationFile: await findParentFolderCalibrationFile(rootPath),
  };

  return scanStereoBatchFromScan(raw);
}

export default scanStereoBatch;
