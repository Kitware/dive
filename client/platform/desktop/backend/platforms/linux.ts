/**
 * VIAME process manager for linux platform
 */
import path from 'path';
import { spawn } from 'child_process';
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs-extra';

import { Settings, SettingsCurrentVersion } from 'platform/desktop/store/settings';
import common from './common';

const DefaultSettings: Settings = {
  // The current settings schema config
  version: SettingsCurrentVersion,
  // A path to the VIAME base install
  viamePath: '/opt/noaa/viame',
  // Path to a user data folder
  dataPath: '~/viamedata',
};

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

/**
 * Fashioned as a node.js implementation of viame_tasks.tasks.run_pipeline
 *
 * @param p dataset path absolute
 * @param pipeline pipeline file basename
 * @param settings global settings
 */
async function runPipeline(p: string, pipeline: string, settings: Settings) {
  const isValid = await validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }
  const setupScriptPath = path.join(settings.viamePath, 'setup_viame.sh');
  const pipelinePath = path.join(settings.viamePath, 'configs/pipelines', pipeline);
  const datasetInfo = await common.getDatasetBase(p);

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
  } else if (datasetInfo.datasetType === 'image-sequence') {
    // command = [
    //   `source ${setupScriptPath} &&`,
    //   'kwiver runner',
    //   `-p ${pipelinePath}`,
    // ]
  }
  return Promise.resolve(command);
}

export default {
  DefaultSettings,
  validateViamePath,
  runPipeline,
};
