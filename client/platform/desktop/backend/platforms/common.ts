/**
 * Common native implementations
 */
import npath from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs-extra';
// eslint-disable-next-line import/no-extraneous-dependencies
import { shell } from 'electron';
import { DatasetType, Pipelines } from 'viame-web-common/apispec';
import { Settings } from 'platform/desktop/store/settings';

const AuxFolderName = 'auxiliary';
// Match examples:
// result_09-14-2020_14-49-05.json
// result_<ANYTHING>.json
// result.json
const JsonFileName = /^result(_.*)?\.json$/;

async function getDatasetBase(datasetId: string): Promise<{
  datasetType: DatasetType;
  basePath: string;
  name: string;
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
    throw new Error('Only regular files and directories are supported');
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
    name: npath.parse(datasetId).name,
    directoryContents: contents,
  };
}

async function getPipelineList(settings: Settings): Promise<Pipelines> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const allowedPatterns = /^detector_.+|^tracker_.+|^generate_.+/;
  const disallowedPatterns = /.*local.*|detector_svm_models.pipe|tracker_svm_models.pipe/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) return {};
  let pipes = await fs.readdir(pipelinePath);
  pipes = pipes.filter((p) => p.match(allowedPatterns) && !p.match(disallowedPatterns));

  /* TODO: fetch trained pipelines */
  const ret: Pipelines = {};
  pipes.forEach((p) => {
    const parts = p.replace('.pipe', '').split('_');
    const pipeType = parts[0];
    const pipeName = parts.slice(1).join(' ');
    const pipeInfo = {
      name: pipeName,
      type: pipeType,
      pipe: p,
    };
    if (pipeType in ret) {
      ret[pipeType].pipes.push(pipeInfo);
    } else {
      ret[pipeType] = {
        pipes: [pipeInfo],
        description: '',
      };
    }
  });
  return ret;
}

/**
 * Create aux directory if none exists
 * @param baseDir parent
 */
async function getAuxFolder(baseDir: string): Promise<string> {
  const auxFolderPath = npath.join(baseDir, AuxFolderName);
  if (!fs.existsSync(auxFolderPath)) {
    await fs.mkdir(auxFolderPath);
  }
  return auxFolderPath;
}

async function openLink(url: string) {
  shell.openExternal(url);
}

export default {
  openLink,
  getAuxFolder,
  getDatasetBase,
  getPipelineList,
};
