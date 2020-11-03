/**
 * Native services that directly interact with the OS.
 * I'm not sure whether I want to call these from render or main thread.
 * IPC module is not ideal for transferring such large amounts of data.
 * It would be reasonable to use HTTP either with the embedded server
 * or perhaps a custom `local-file` protocol
 *
 * https://nklayman.github.io/vue-cli-plugin-electron-builder/guide/configuration.html#changing-the-file-loading-protocol
 */

import npath from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs-extra';
import moment from 'moment';

import { TrackData } from 'vue-media-annotator/track';
import { SaveDetectionsArgs } from 'viame-web-common/apispec';

import common from '../backend/platforms/common';

const CsvFileName = /^viame-annotations.csv$/;

/**
 * @param path a known, existing path
 */
async function loadJsonAnnotations(path: string): Promise<Record<string, TrackData>> {
  const rawBuffer = await fs.readFile(path, 'utf-8');
  const annotationData = JSON.parse(rawBuffer);
  // TODO: validate json schema
  return annotationData as Record<string, TrackData>;
}

/**
 * @param path a known, existing path
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function loadCSVAnnotations(path: string): Promise<Record<string, TrackData>> {
  // TODO: maybe come up with a way to invoke python csv -> json transcoding
  // Otherwise we'll have to reimplement in Node.js
  return {};
}

async function loadDetections(datasetId: string, ignoreCSV = false) {
  const empty = Promise.resolve({} as { [key: string]: TrackData });
  const base = await common.getDatasetBase(datasetId);

  /* First, look for a JSON file */
  if (base.jsonFile) {
    const annotations = loadJsonAnnotations(npath.join(base.basePath, base.jsonFile));
    return annotations;
  }

  if (ignoreCSV) {
    return empty;
  }

  /* Then, look for a CSV */
  const csvFileCandidates = base.directoryContents.filter((v) => CsvFileName.test(v));
  if (csvFileCandidates.length === 1) {
    const annotations = loadCSVAnnotations(npath.join(base.basePath, csvFileCandidates[0]));
    return annotations;
  }

  /* return empty by default */
  return empty;
}

async function saveDetections(datasetId: string, args: SaveDetectionsArgs) {
  const time = moment().format('MM-DD-YYYY_HH-MM-SS');
  const newFileName = `result_${time}.json`;
  const base = await common.getDatasetBase(datasetId);

  // TODO: Validate SaveDetectionArgs

  /* Update existing track file */
  const existing = await loadDetections(datasetId, true);
  args.delete.forEach((trackId) => delete existing[trackId.toString()]);
  args.upsert.forEach((track, trackId) => {
    existing[trackId.toString()] = track.serialize();
  });

  const auxFolderPath = await common.getAuxFolder(base.basePath);

  /* Move old file if it exists */
  if (base.jsonFile) {
    await fs.move(
      npath.join(base.basePath, base.jsonFile),
      npath.join(auxFolderPath, base.jsonFile),
    );
  }

  const serialized = JSON.stringify(existing);

  /* Save new file */
  await fs.writeFile(npath.join(base.basePath, newFileName), serialized);
}

export {
  loadDetections,
  saveDetections,
};
