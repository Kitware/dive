/**
 * Batch multicam import scanner (desktop filesystem backend).
 */
import npath from 'path';
import fs from 'fs-extra';
import {
  CollectRawScan,
  CollectSubfolderScan,
  scanMultiCamBatchFromCollects,
} from 'dive-common/multiCamBatchScan';
import {
  findImagesInFolder,
  findParentFolderTransformFiles,
  listImmediateSubfolders,
} from './common';

async function scanCollectFolder(collectPath: string): Promise<Map<string, CollectSubfolderScan>> {
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

async function scanMultiCamBatch(rootPath: string) {
  const collectNames = (await listImmediateSubfolders(rootPath))
    .sort((a, b) => a.localeCompare(b));

  const rawScans: CollectRawScan[] = [];
  for (let i = 0; i < collectNames.length; i += 1) {
    const name = collectNames[i];
    const collectPath = npath.join(rootPath, name);
    rawScans.push({
      name,
      path: collectPath,
      // eslint-disable-next-line no-await-in-loop
      subfolders: await scanCollectFolder(collectPath),
      // Per-collect registration files sit next to the camera subfolders.
      // eslint-disable-next-line no-await-in-loop
      transformFiles: await findParentFolderTransformFiles(collectPath),
    });
  }

  return scanMultiCamBatchFromCollects(rootPath, rawScans);
}

export default scanMultiCamBatch;
