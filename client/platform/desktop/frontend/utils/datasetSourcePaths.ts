import {
  Camera, DesktopMetadata, JsonMeta, ProjectsFolderName, Settings,
} from 'platform/desktop/constants';

export interface LabeledPath {
  label: string;
  path: string;
}

export interface CameraSourceFolder {
  name: string;
  path: string;
}

export interface DatasetSourceInfo {
  datasetName: string;
  projectDirectory: string;
  mediaSource: LabeledPath | null;
  sourceFolder: LabeledPath | null;
  cameraSourceFolders: CameraSourceFolder[];
  sourceCalibration: string | null;
}

function joinPath(base: string, file: string): string {
  if (!base) {
    return file;
  }
  if (!file) {
    return base;
  }
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${file.replace(/^[\\/]+/, '')}`;
}

function dirname(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/';
  const index = filePath.lastIndexOf(sep);
  if (index <= 0) {
    return filePath;
  }
  return filePath.slice(0, index);
}

function isAbsolutePath(filePath: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(filePath);
}

function getProjectDirectory(datasetId: string, appSettings: Settings | null): string {
  const dataPath = appSettings?.dataPath ?? '';
  const parentId = datasetId.split('/')[0];
  return joinPath(joinPath(dataPath, ProjectsFolderName), parentId);
}

/** Original import location for a multi-camera feed (never transcoded project media). */
function getCameraSourceFolder(camera: Camera): string {
  if (camera.imageListPath) {
    return camera.originalBasePath || dirname(camera.imageListPath);
  }
  if (camera.type === 'video' && camera.originalVideoFile) {
    return joinPath(camera.originalBasePath, camera.originalVideoFile);
  }
  return camera.originalBasePath;
}

function getSingleCameraPaths(meta: JsonMeta): { mediaSource: string; sourceFolder: string } {
  if (meta.type === 'video') {
    return {
      mediaSource: joinPath(meta.originalBasePath, meta.originalVideoFile),
      sourceFolder: meta.originalBasePath,
    };
  }
  if (meta.type === 'large-image') {
    return {
      mediaSource: joinPath(meta.originalBasePath, meta.originalLargeImageFile || ''),
      sourceFolder: meta.originalBasePath,
    };
  }
  if (meta.imageListPath) {
    return {
      mediaSource: meta.imageListPath,
      sourceFolder: meta.originalBasePath || dirname(meta.imageListPath),
    };
  }
  if (meta.originalBasePath) {
    return {
      mediaSource: meta.originalBasePath,
      sourceFolder: meta.originalBasePath,
    };
  }
  const firstImage = meta.originalImageFiles[0];
  if (firstImage && isAbsolutePath(firstImage)) {
    return {
      mediaSource: firstImage,
      sourceFolder: dirname(firstImage),
    };
  }
  return { mediaSource: '', sourceFolder: '' };
}

/**
 * Resolve the user's original calibration file path. New datasets store
 * `calibrationSourcePath`; older datasets only stored the basename.
 */
function resolveCalibrationSourcePath(meta: JsonMeta): string | null {
  const { multiCam } = meta;
  if (!multiCam?.calibration && !multiCam?.calibrationOriginalName) {
    return null;
  }
  if (multiCam.calibrationSourcePath) {
    return multiCam.calibrationSourcePath;
  }
  const originalName = multiCam.calibrationOriginalName;
  if (!originalName) {
    return null;
  }
  if (meta.originalBasePath) {
    return joinPath(meta.originalBasePath, originalName);
  }
  const cameras = Object.values(multiCam.cameras || {});
  if (cameras.length > 0 && cameras[0].originalBasePath) {
    return joinPath(dirname(cameras[0].originalBasePath), originalName);
  }
  return null;
}

export function buildDatasetSourceInfo(
  meta: DesktopMetadata,
  appSettings: Settings | null,
): DatasetSourceInfo {
  const projectDirectory = getProjectDirectory(meta.id, appSettings);
  const result: DatasetSourceInfo = {
    datasetName: meta.name,
    projectDirectory,
    mediaSource: null,
    sourceFolder: null,
    cameraSourceFolders: [],
    sourceCalibration: resolveCalibrationSourcePath(meta),
  };

  const isMultiCam = meta.multiCam?.cameras && Object.keys(meta.multiCam.cameras).length > 0;
  if (isMultiCam) {
    Object.entries(meta.multiCam!.cameras).forEach(([name, camera]) => {
      const path = getCameraSourceFolder(camera);
      if (path) {
        result.cameraSourceFolders.push({ name, path });
      }
    });
    return result;
  }

  const paths = getSingleCameraPaths(meta);
  if (paths.mediaSource) {
    result.mediaSource = { label: 'Source Media', path: paths.mediaSource };
  }
  if (paths.sourceFolder && paths.sourceFolder !== paths.mediaSource) {
    result.sourceFolder = { label: 'Source Folder', path: paths.sourceFolder };
  }
  return result;
}
