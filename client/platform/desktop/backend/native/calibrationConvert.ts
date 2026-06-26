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
 * True when a file can be parsed as JSON. Used to tell a real KWIVER JSON
 * camera-rig from a binary calibration file (e.g. an .npz) that was merely
 * named ".json".
 */
async function isValidJson(filePath: string): Promise<boolean> {
  try {
    await fs.readJSON(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * True when the file starts with the ZIP local-file-header magic ("PK\x03\x04").
 * NumPy .npz archives are ZIP files, so this catches an .npz mislabeled .json.
 */
async function looksLikeZip(filePath: string): Promise<boolean> {
  const fd = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(2);
    await fs.read(fd, buf, 0, 2, 0);
    return buf[0] === 0x50 && buf[1] === 0x4b;
  } finally {
    await fs.close(fd);
  }
}

/**
 * Store a stereo calibration / camera file alongside a dataset's media and
 * normalize it to the JSON camera-rig format.
 *
 * The original file is always copied into the dataset directory (preserved).
 * Non-JSON formats — including files named ".json" that are actually binary
 * (e.g. an .npz copied to last_calibration.json) — are converted to JSON via
 * VIAME; the JSON copy is used for pipelines when conversion succeeds,
 * otherwise the original is used.
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
  const ext = npath.extname(originalDest).toLowerCase();
  // A .json that actually parses as JSON is already the format we want.
  if (ext === '.json' && await isValidJson(originalDest)) {
    return originalDest;
  }
  const base = npath.basename(originalDest, npath.extname(originalDest));
  // convert_cam_format.py detects the input format by extension, so a binary
  // file mislabeled ".json" must be given its true extension first.
  let convertSource = originalDest;
  if (ext === '.json' && await looksLikeZip(originalDest)) {
    convertSource = npath.join(projectDirAbsPath, `${base}.npz`);
    if (npath.resolve(convertSource) !== npath.resolve(originalDest)) {
      await fs.copy(originalDest, convertSource, { overwrite: true });
    }
  }
  const jsonDest = npath.join(projectDirAbsPath, `${base}.json`);
  const converted = await convertCalibrationToJson(settings, convertSource, jsonDest);
  return converted ? jsonDest : originalDest;
}

export {
  convertCalibrationToJson,
  prepareDatasetCalibration,
};
