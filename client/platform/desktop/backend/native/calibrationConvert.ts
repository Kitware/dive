/**
 * Stereo camera calibration file handling for the desktop backend.
 *
 * VIAME ships a `convert_cam_format.py` tool (installed under
 * `<viamePath>/configs/`) that reads any supported stereo calibration format
 * (npz, opencv yml, matlab mat, zed, CamCAL, ...) and writes KWIVER's JSON
 * camera-rig format. We normalize every imported calibration to that JSON so the
 * measurement pipeline always consumes a single, consistent format, while still
 * keeping the user's original file alongside the media.
 */
import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';

import { Settings } from 'platform/desktop/constants';
import { observeChild } from 'platform/desktop/backend/native/processManager';

const ConvertToolRelativePath = npath.join('configs', 'convert_cam_format.py');

/**
 * Run VIAME's convert_cam_format.py to convert a calibration file to the
 * KWIVER-compatible JSON camera-rig format.
 * @returns true if the JSON file was produced, false if conversion was
 *   unavailable (e.g. VIAME not configured) or failed.
 */
async function convertCalibrationToJson(
  settings: Settings,
  sourcePath: string,
  destJsonPath: string,
): Promise<boolean> {
  const isWin = process.platform === 'win32';
  const setupScript = npath.join(settings.viamePath, isWin ? 'setup_viame.bat' : 'setup_viame.sh');
  const toolPath = npath.join(settings.viamePath, ConvertToolRelativePath);
  if (!(await fs.pathExists(setupScript)) || !(await fs.pathExists(toolPath))) {
    return false;
  }
  const sourceCmd = isWin ? `call "${setupScript}"` : `. "${setupScript}"`;
  const command = `${sourceCmd} && python "${toolPath}" "${sourcePath}" "${destJsonPath}"`;
  const child = observeChild(spawn(command, { shell: isWin ? true : '/bin/bash' }));
  const exitCode: number | null = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  const produced = await fs.pathExists(destJsonPath);
  return exitCode === 0 && produced;
}

/**
 * Store a stereo calibration / camera file alongside a dataset's media and
 * normalize it to the JSON camera-rig format.
 *
 * The original file is always copied into the dataset directory (preserved).
 * Non-JSON formats are additionally converted to JSON via VIAME; the JSON copy
 * is used for pipelines when conversion succeeds, otherwise the original is used.
 *
 * @returns absolute path of the calibration file the dataset should reference.
 */
async function prepareDatasetCalibration(
  settings: Settings,
  projectDirAbsPath: string,
  sourcePath: string,
): Promise<string> {
  const originalDest = npath.join(projectDirAbsPath, npath.basename(sourcePath));
  if (npath.resolve(originalDest) !== npath.resolve(sourcePath)) {
    await fs.copy(sourcePath, originalDest, { overwrite: true });
  }
  if (npath.extname(originalDest).toLowerCase() === '.json') {
    return originalDest;
  }
  const base = npath.basename(originalDest, npath.extname(originalDest));
  const jsonDest = npath.join(projectDirAbsPath, `${base}.json`);
  const converted = await convertCalibrationToJson(settings, originalDest, jsonDest);
  return converted ? jsonDest : originalDest;
}

export {
  convertCalibrationToJson,
  prepareDatasetCalibration,
};
