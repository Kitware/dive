/**
 * VIAME process manager for linux platform
 */
import path from 'path';
import { spawn } from 'child_process';
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs-extra';

import { Pipelines } from 'viame-web-common/apispec';

import { Settings, SettingsCurrentVersion } from '../../store/settings';
import { getDatasetBase } from '../../api/nativeServices';

const DefaultSettings: Settings = {
  // The current settings schema config
  version: SettingsCurrentVersion,
  // A path to the VIAME base install
  viamePath: '/opt/noaa/viame',
};

async function getPipelineList(settings: Settings): Promise<Pipelines> {
  const pipelinePath = path.join(settings.viamePath, 'configs/pipelines');
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

async function validateViamePath(settings: Settings): Promise<true | string> {
  const setupScriptPath = path.join(settings.viamePath, 'setup_viame.sh');
  const setupExists = await fs.pathExists(setupScriptPath);
  if (!setupExists) {
    return `${setupScriptPath} does not exist`;
  }

  const kwiverExistsOnPath = spawn(
    `source ${setupScriptPath} && which kwiver`,
    { shell: '/bin/bash' },
  );
  return new Promise((resolve) => {
    kwiverExistsOnPath.on('exit', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        resolve('kwiver failed to initialize');
      }
    });
  });
}

// command = [
//   f"cd {conf.viame_install_path} &&",
//   ". ./setup_viame.sh &&",
//   "kwiver runner",
//   "-s input:video_reader:type=vidl_ffmpeg",
//   f"-p {pipeline_path}",
//   f"-s input:video_filename={input_file}",
//   f"-s detector_writer:file_name={detector_output_path}",
//   f"-s track_writer:file_name={track_output_path}",
// ]
// elif input_type == 'image-sequence':
// with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as temp2:
//   temp2.writelines(
//       (
//           (os.path.join(input_path, file_name) + "\n").encode()
//           for file_name in sorted(filtered_directory_files)
//       )
//   )
//   image_list_file = temp2.name
// command = [
//   f"cd {conf.viame_install_path} &&",
//   ". ./setup_viame.sh &&",
//   "kwiver runner",
//   f"-p {pipeline_path}",
//   f"-s input:video_filename={image_list_file}",
//   f"-s detector_writer:file_name={detector_output_path}",
//   f"-s track_writer:file_name={track_output_path}",
// ]

async function runPipeline(p: string, pipeline: string, settings: Settings) {
  const isValid = await validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }
  const setupScriptPath = path.join(settings.viamePath, 'setup_viame.sh');
  const pipelinePath = path.join(settings.viamePath, 'configs/pipelines', pipeline);
  const datasetInfo = await getDatasetBase(p);

  let command: string[] = [];
  if (datasetInfo.datasetType === 'video') {
    command = [
      `source ${setupScriptPath} &&`,
      'kwiver runner',
      '-s input:video_reader:type-vidl_ffmpeg',
      `-p ${pipelinePath}`,
      `-s input:video_filename=${p}`,
      '-s detector_writer:file_name',
    ];
  }
  return Promise.resolve(command);
}

export default {
  DefaultSettings,
  validateViamePath,
  getPipelineList,
  runPipeline,
};
