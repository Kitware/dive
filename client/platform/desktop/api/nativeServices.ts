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
import { SaveDetectionsArgs, DatasetType } from 'viame-web-common/apispec';

// Match examples:
// result_09-14-2020_14:49:05.json
// result.json
const JsonFileName = /^result(_\d\d-\d\d-\d\d\d\d_\d\d:\d\d:\d\d)?\.json$/;
const CsvFileName = /^viame-annotations.csv$/;
const AuxFolderName = 'auxiliary';

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

async function getDatasetBase(datasetId: string): Promise<{
  datasetType: DatasetType;
  basePath: string;
  jsonFile: string | null;
  directoryContents: string[];
}> {
  let datasetType: DatasetType = 'image-sequence';
  const exists = fs.existsSync(datasetId);
  if (!exists) {
    throw new Error(`No dataset exists with path ${datasetId}`);
  }
  const stat = await fs.stat(datasetId);

  if (stat.isDirectory()) {
    datasetType = 'image-sequence';
  } else if (stat.isFile()) {
    datasetType = 'video';
  } else {
    throw new Error('Symlinks not supported');
  }

  let datasetFolderPath = datasetId;
  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    datasetFolderPath = npath.dirname(datasetId);
  }

  const contents = await fs.readdir(datasetFolderPath);
  const jsonFileCandidates = contents.filter((v) => JsonFileName.test(v));
  let jsonFile = null;

  if (jsonFileCandidates.length > 1) {
    throw new Error('Too many matches for json annotation file!');
  } else if (jsonFileCandidates.length === 1) {
    [jsonFile] = jsonFileCandidates;
  }

  return {
    datasetType,
    basePath: datasetFolderPath,
    jsonFile,
    directoryContents: contents,
  };
}

async function loadDetections(datasetId: string, ignoreCSV = false) {
  const empty = Promise.resolve({} as { [key: string]: TrackData });
  const base = await getDatasetBase(datasetId);

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
  const time = moment().format('MM-DD-YYYY_HH:MM:SS');
  const newFileName = `result_${time}.json`;
  const base = await getDatasetBase(datasetId);

  // TODO: Validate SaveDetectionArgs

  /* Update existing track file */
  const existing = await loadDetections(datasetId, true);
  args.delete.forEach((trackId) => delete existing[trackId.toString()]);
  args.upsert.forEach((track, trackId) => {
    existing[trackId.toString()] = track.serialize();
  });

  /* Create auxillar directory if none exists */
  const auxFolderPath = npath.join(base.basePath, AuxFolderName);
  if (!fs.existsSync(auxFolderPath)) {
    await fs.mkdir(auxFolderPath);
  }

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
