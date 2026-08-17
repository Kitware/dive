/**
 * Common native implementations
 */

import npath from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { shell } from 'electron';
import mime from 'mime-types';
import moment from 'moment';
import lockfile from 'proper-lockfile';
import {
  cloneDeep, merge, uniq, pick,
} from 'lodash';

import { DefaultConfidence } from 'vue-media-annotator/BaseFilterControls';
import { TrackData } from 'vue-media-annotator/track';
import { GroupData } from 'vue-media-annotator/Group';
import {
  DatasetType, Pipelines, SaveDetectionsArgs,
  FrameImage, DatasetConfigMutable, TrainingConfig, TrainingConfigs, SaveAttributeArgs,
  MultiCamMedia,
  DatasetConfigMutableKeys,
  MulticamSharedMutableKeys,
  AnnotationSchema,
  SaveAttributeTrackFilterArgs,
  Pipe,
  PipeMetadata,
  PipelineParamType,
  FrameMetadataAttachmentText,
  FrameMetadataSourcesResponse,
} from 'dive-common/apispec';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import { parseCameraOrderHeader } from 'dive-common/pipelineCameraOrder';
import isFrameMetadataSourceName from 'dive-common/frameMetadata/naming';
import {
  METADATA_ATTACHMENT_UNAVAILABLE, isFrameMetadataReadableName,
} from 'dive-common/frameMetadata/readability';
import { parentDatasetId, parseCompositeDatasetId } from 'dive-common/compositeDatasetId';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';
import * as nistSerializers from 'platform/desktop/backend/serializers/nist';
import * as dive from 'platform/desktop/backend/serializers/dive';
import * as coco from 'platform/desktop/backend/serializers/coco';
import kpf from 'platform/desktop/backend/serializers/kpf';
// TODO:  Check to Refactor this
import { checkMedia } from 'platform/desktop/backend/native/mediaJobs';
import {
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes, fileVideoTypes,
  MultiType, JsonConfigRegEx, largeImageDesktopTypes, metadataFileTypes,
} from 'dive-common/constants';
import {
  JsonConfig, Settings, JsonConfigCurrentVersion, DesktopConfig,
  RunTraining, ExportDatasetArgs, DesktopMediaImportResponse,
  ExportConfigurationArgs, JobsFolderName, JobsOutputFolderName, ProjectsFolderName,
  PipelinesFolderName, ConversionArgs,
  JobType, DesktopJob,
} from 'platform/desktop/constants';
import {
  cleanString, filterByGlob, makeid, strNumericCompare,
} from 'platform/desktop/sharedUtils';
import { parseFrameTimestamp } from 'dive-common/frameTimestamp';
import {
  HierarchyWrite,
  normalizeTypeHierarchy,
  resolveTypeHierarchy,
  TypeHierarchyError,
} from 'dive-common/typeHierarchy';

import processTrackAttributes from './attributeProcessor';
import { upgrade } from './migrations';
// TODO:  Check to Refactor this
import { getMultiCamUrls, transcodeMultiCam } from './multiCamUtils';
import {
  loadRegistrationFiles, referenceCameraName, saveRegistrationToDatasetDir,
} from './cameraRegistration';
import { prepareDatasetCalibration } from './calibrationConvert';
import { realCalibrationName } from './datasetCalibration';
import { splitExt } from './utils';

const AuxFolderName = 'auxiliary';
// Where an export archive stores each dataset scope's metadata attachment.
const ArchiveMetadataFolderName = 'metadata';

const JsonTrackFileName = /^result(_.*)?\.json$/i;
const JsonFileName = /^.*\.json$/i;
/**
 * Canonical desktop project dataset file under DIVE_Projects (media paths, id,
 * type, multicam layout, …). Distinct from the portable Configuration File
 * (`config.json`) used on import/export.
 */
const DatasetFileName = 'dataset.json';
/** Legacy project filename; still read, migrated away on save. */
const DatasetFileNameLegacy = 'meta.json';
/** Portable Configuration File name used on import/export (not the project store). */
const PortableConfigFileName = 'config.json';
const DiveJobManifestName = 'dive_job_manifest.json';
const PortableConfigFileNameLegacy = 'meta.json';
const CsvFileName = /^.*\.csv$/i;
const YAMLFileName = /^.*\.ya?ml$/i;

const invalidHierarchyMessage = (reason: string) => (
  `Type hierarchy is invalid: ${reason}. No configuration was changed.`
);

const corruptHierarchyExportMessage = (reason: string, artifact = 'configuration file') => (
  `Type hierarchy is invalid: ${reason}. No ${artifact} was exported.`
);

function normalizedHierarchyForExport(
  meta: { typeHierarchy?: unknown },
  artifact?: string,
) {
  try {
    return Object.prototype.hasOwnProperty.call(meta, 'typeHierarchy')
      ? normalizeTypeHierarchy(meta.typeHierarchy)
      : undefined;
  } catch (error) {
    if (error instanceof TypeHierarchyError) {
      throw new Error(corruptHierarchyExportMessage(error.reason, artifact));
    }
    throw error;
  }
}

class DataFileJsonParseError extends Error {}

/**
 * Resolve the project dataset.json path: prefer dataset.json, fall back to
 * legacy meta.json for existing datasets, else the preferred name for new projects.
 */
function resolveDatasetFileAbsPath(basePath: string): string {
  const preferred = npath.join(basePath, DatasetFileName);
  const legacy = npath.join(basePath, DatasetFileNameLegacy);
  if (fs.pathExistsSync(preferred)) {
    return preferred;
  }
  if (fs.pathExistsSync(legacy)) {
    return legacy;
  }
  return preferred;
}

/**
 * Read a text file into a list of lines
 */
async function readLines(filePath: string): Promise<string[]> {
  const rawBuffer = await fs.readFile(filePath, 'utf-8');
  return rawBuffer.toString().replace(/\r\n/g, '\n').split('\n');
}

type DiveParam = NonNullable<PipeMetadata['diveParams']>[number];

/**
 * Parse DIVE_PARAM declarations and include directives from pipe lines.
 */
function parseDiveParamLines(lines: string[]) {
  const params: DiveParam[] = [];
  const includes: string[] = [];
  let contextStack: string[] = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const includeMatch = trimmed.match(/^include\s+(\S+)/i);
    if (includeMatch) {
      includes.push(includeMatch[1]);
      return;
    }

    const processMatch = trimmed.match(/^process\s+([\w-]+)/i);
    if (processMatch) {
      contextStack = [processMatch[1]];
      return;
    }

    const blockMatch = trimmed.match(/^block\s+([\w:-]+)/i);
    if (blockMatch) {
      contextStack.push(blockMatch[1]);
      return;
    }

    if (trimmed.toLowerCase() === 'endblock') {
      contextStack.pop();
      return;
    }

    // `config <key>` opens a config block; its entries are keyed under the
    // block name (e.g. `config global` + `:scale` -> `global:scale`).
    const configBlockMatch = trimmed.match(/^config\s+([\w:.-]+)\s*(?:#.*)?$/i);
    if (configBlockMatch) {
      contextStack = configBlockMatch[1].split(':');
      return;
    }

    const diveMatch = line.match(/#\s*DIVE_PARAM\s*\[\s*"([^"]+)"\s*,\s*(.+)\s*\]/i);
    if (diveMatch) {
      const [, label, rawArgs] = diveMatch;
      const args = rawArgs.split(',').map((arg) => arg.trim());
      const type: PipelineParamType = args[0] as PipelineParamType;
      const restArgs = args.slice(1);
      // `required` is a flag keyword — strip it from type_props,
      // everything else stays positional for the type.
      const isRequired = restArgs.some((a) => a.toLowerCase() === 'required');
      const pipelineTypeArgs = restArgs.filter((a) => a.toLowerCase() !== 'required');

      // `config <key> = <value>` — absolute kwiver key, no process/block prefix
      // applied. Used for global / cross-referenced settings.
      const configMatch = trimmed.match(/^config\s+([\w:.-]+)\s*=\s*([^#]+)/i);
      // Otherwise a regular per-process/block parameter assignment.
      const paramLineMatch = !configMatch
        ? trimmed.match(/^(?:relativepath\s+)?(?::)?([\w:-]+)\s*=?\s*([^#]+)/i)
        : null;

      let fullKey: string | null = null;
      let defaultValue: string | null = null;
      if (configMatch) {
        const [, key, value] = configMatch;
        fullKey = key;
        defaultValue = value.trim();
      } else if (paramLineMatch) {
        fullKey = [...contextStack, paramLineMatch[1]].join(':');
        defaultValue = paramLineMatch[2].trim();
      }

      if (fullKey !== null && defaultValue !== null) {
        params.push({
          label,
          type,
          type_props: pipelineTypeArgs,
          key: fullKey,
          default: defaultValue,
          ...(isRequired ? { required: true } : {}),
        });
      }
    }
  });
  return { params, includes };
}

/**
 * Collect DIVE_PARAMs from a pipe and, recursively, from its includes.
 *
 * Wrapper pipes inherit the params of the pipes they include; a file's own
 * declarations override inherited ones for the same key, matching kwiver's
 * config override order. Includes that cannot be read next to the including
 * file (e.g. $ENV{...} paths resolved by kwiver's own search path) simply
 * contribute no params.
 */
async function collectDiveParams(
  filePath: string,
  collected: Map<string, DiveParam>,
  visited: Set<string>,
): Promise<void> {
  const resolved = npath.resolve(filePath);
  if (visited.has(resolved)) {
    return;
  }
  visited.add(resolved);
  let lines: string[];
  try {
    lines = await readLines(resolved);
  } catch {
    return;
  }
  const { params, includes } = parseDiveParamLines(lines);
  // eslint-disable-next-line no-restricted-syntax
  for (const include of includes.filter((f) => !f.includes('$'))) {
    // eslint-disable-next-line no-await-in-loop
    await collectDiveParams(npath.join(npath.dirname(resolved), include), collected, visited);
  }
  params.forEach((p) => collected.set(p.key, p));
}

/**
 * Extract metadata from a .pipe file header.
 */
async function extractPipeMetadata(filePath: string): Promise<PipeMetadata> {
  const metadata: PipeMetadata = {};
  metadata.diveParams = [];
  try {
    const collected = new Map<string, DiveParam>();
    await collectDiveParams(filePath, collected, new Set());
    metadata.diveParams = Array.from(collected.values());

    const lines = await readLines(filePath);
    let inDescription = false;
    let fullDescription = '';

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // --- Description extraction (Multiline) ---
      if (/^#\s*Description:\s*/i.test(line)) {
        inDescription = true;
        fullDescription = line.replace(/^#\s*Description:\s*/i, '').trim();
        return;
      }

      if (inDescription) {
        if (/^#\s*$/.test(line) || /^#\s*=/.test(line) || /^#\s*(Input|Output|Requires\s+Calibration|Metadata\s+File|Image\s+List\s+Keys?|Calibration\s+Keys?|Camera\s+Order):/i.test(line) || !line.startsWith('#')) {
          inDescription = false;
        } else {
          fullDescription += ` ${line.replace(/^#\s*/, '').trim()}`;
          return;
        }
      }

      // --- Input / Output extraction ---
      if (/^#\s*Input:\s*/i.test(line)) {
        metadata.inputType = line.split(':')[1]?.trim();
      }
      if (/^#\s*Output:\s*/i.test(line)) {
        metadata.outputType = line.split(':')[1]?.trim();
      }

      const calibrationMatch = line.match(/^#\s*Requires\s+Calibration:\s*(.*)/i);
      if (calibrationMatch) {
        const value = calibrationMatch[1].trim().toLowerCase();
        metadata.requiresCalibration = ['true', 'yes', '1'].includes(value);
      }

      // `# Metadata File: <block>:<key>` opts a pipe in to receiving the
      // dataset's optional metadata file as a `-s <block>:<key>=<path>` override.
      const metadataFileMatch = line.match(/^#\s*Metadata\s+File:\s*(.+)/i);
      if (metadataFileMatch) {
        const value = metadataFileMatch[1].trim();
        if (value) {
          metadata.metadataFileKey = value;
        }
      }

      // `# Image List Keys: <k> [k...]` binds the run's input image list(s) (one
      // per camera; multicam comma-joined) to each key, so pipes (e.g. the
      // sea-lion registration stabilizer) read the same image list DIVE feeds the
      // input reader.
      const imageListMatch = line.match(/^#\s*Image\s+List\s+Keys?:\s*(.+)/i);
      if (imageListMatch) {
        const keys = imageListMatch[1].trim().split(/[\s,]+/).filter((k) => k);
        if (keys.length) {
          metadata.imageListKeys = keys;
        }
      }

      // `# Calibration Keys: <k> [k...]` binds the dataset's stereo calibration
      // file to each listed KWIVER key. Needed because `$CONFIG{global:...}`
      // indirection cannot receive `-s` overrides (macros expand at parse time,
      // `-s` blocks are appended last), so a pipe must name the consuming process
      // key directly.
      const calibrationKeysMatch = line.match(/^#\s*Calibration\s+Keys?:\s*(.+)/i);
      if (calibrationKeysMatch) {
        const keys = calibrationKeysMatch[1].trim().split(/[\s,]+/).filter((k) => k);
        if (keys.length) {
          metadata.calibrationKeys = keys;
        }
      }

      // `# Camera Order: EO, UV, IR` names the camera role fed to each inputN of
      // a 2-cam/3-cam pipe; DIVE matches dataset cameras onto it by name.
      const cameraOrderMatch = line.match(/^#\s*Camera\s+Order:\s*(.+)/i);
      if (cameraOrderMatch) {
        const slots = parseCameraOrderHeader(cameraOrderMatch[1]);
        if (slots.length) {
          metadata.cameraOrder = slots;
        }
      }
    });
    metadata.description = fullDescription.trim() || undefined;
  } catch (error) {
    console.error(`Error while reading ${filePath} metadata`, error);
  }

  return metadata;
}

/**
 * Read a text file as json
 */
async function _loadAsJson(abspath: string) {
  const rawBuffer = await fs.readFile(abspath, 'utf-8');
  if (rawBuffer.length === 0) {
    return false;
  }
  try {
    return JSON.parse(rawBuffer);
  } catch (err) {
    throw new DataFileJsonParseError(`Unable to parse ${abspath}: ${err}`);
  }
}

/**
 * findImagesInFolder
 * Import either a directory of images or images from a text file
 * Images returned will be MIME-validated and guaranteed to exist on disk.
 * Actual file contents will not be checked.
 */
async function findImagesInFolder(path: string, glob?: string) {
  const filteredImagePaths: string[] = [];
  let requiresTranscoding = false;
  let imagePaths: string[];
  const stat = await fs.stat(path);
  let source: 'directory' | 'image-list' = 'directory';

  if (stat.isDirectory()) {
    imagePaths = (await fs.readdir(path))
      .map((name) => npath.join(path, name));
  } else {
    source = 'image-list';
    imagePaths = (await readLines(path))
      // remove lines that are just whitespace
      .filter((line) => line.trim())
      // Transform relative paths to absolute paths using list directory location.
      .map((line) => {
        if (npath.isAbsolute(line)) {
          return npath.normalize(line);
        }
        return npath.join(npath.dirname(path), line);
      });
    if (imagePaths.length === 0) {
      throw new Error('No images in input image list');
    }
    if (uniq(imagePaths).length !== imagePaths.length) {
      throw new Error('Duplicate entries detected in image list');
    }
    // Need to assert that every file in the image list exists
    for (let i = 0; i < imagePaths.length; i += 1) {
      const absPath = imagePaths[i];
      // eslint-disable-next-line no-await-in-loop
      if (!(await fs.pathExists(absPath))) {
        throw new Error(`Image from image list ${absPath} was not found`);
      }
    }
  }

  imagePaths.forEach((absPath) => {
    const mimetype = mime.lookup(absPath);
    const filename = npath.basename(absPath);
    if (glob === undefined || filterByGlob(glob, [filename]).length === 1) {
      if (
        mimetype && (websafeImageTypes.includes(mimetype)
          || otherImageTypes.includes(mimetype))
      ) {
        filteredImagePaths.push(absPath);
        if (otherImageTypes.includes(mimetype)) {
          requiresTranscoding = true;
        }
      } else if (source === 'image-list') {
        /* A non-image was found in an image list */
        throw new Error('Found non-image type data in image list file');
      }
    }
  });

  return {
    imagePaths: filteredImagePaths,
    imageNames: filteredImagePaths.map((absPath) => npath.basename(absPath)),
    mediaConvertList: requiresTranscoding ? filteredImagePaths : [],
    source,
  };
}

async function _acquireLock(dir: string, resource: string, lockname: 'meta' | 'tracks') {
  const release = await lockfile.lock(resource, {
    stale: 5000, // 5 seconds
    lockfilePath: npath.join(dir, `${lockname}.lock`),
  });
  return release;
}

async function _findCSVTrackFiles(searchPath: string) {
  const contents = await fs.readdir(searchPath);
  const csvFileCandidates = contents
    .filter((v) => CsvFileName.test(v))
    .map((filename) => npath.join(searchPath, filename));
  return csvFileCandidates;
}

/**
 * locate json track file in a directory
 * @param path path to a directory
 * @returns object containing trackAbsPath and metaPath if it exists
 */
async function _findJsonAndMetaTrackFile(basePath: string): Promise<
  {trackFileAbsPath: string; configFileAbsPath?: string}> {
  const contents = await fs.readdir(basePath);
  const jsonFileCandidates: string[] = [];
  let configFileAbsPath: undefined | string;
  await Promise.all(contents.map(async (name) => {
    const fullPath = npath.join(basePath, name);
    if (JsonTrackFileName.test(name)) {
      const statResult = await fs.stat(fullPath);
      if (statResult.isFile()) {
        jsonFileCandidates.push(fullPath);
      }
    } else if (JsonConfigRegEx.test(name)) {
      // Prefer exact portable config.json, then legacy meta.json, then other
      // *.meta/config.json. dataset.json is the desktop project store and is
      // not matched by JsonConfigRegEx.
      const lower = name.toLowerCase();
      const current = configFileAbsPath
        ? npath.basename(configFileAbsPath).toLowerCase()
        : '';
      if (lower === PortableConfigFileName) {
        configFileAbsPath = fullPath;
      } else if (lower === PortableConfigFileNameLegacy && current !== PortableConfigFileName) {
        configFileAbsPath = fullPath;
      } else if (!configFileAbsPath) {
        configFileAbsPath = fullPath;
      }
    }
  }));
  if (jsonFileCandidates.length > 0) {
    return { trackFileAbsPath: jsonFileCandidates[0], configFileAbsPath };
  }
  return { trackFileAbsPath: '', configFileAbsPath };
}

/**
 * getProjectDir returns filepaths to required members of a dataset project directory.
 */
function getProjectDir(settings: Settings, datasetId: string) {
  const basePath = npath.join(settings.dataPath, ProjectsFolderName, datasetId);
  const auxDirAbsPath = npath.join(basePath, AuxFolderName);
  return {
    auxDirAbsPath,
    basePath,
    datasetFileAbsPath: resolveDatasetFileAbsPath(basePath),
  };
}

/**
 * REQUIRED members: dataset.json (or legacy meta.json), results*.json
 * OPTIONAL members: aux/ will be created if none exists
 */
async function getValidatedProjectDir(settings: Settings, datasetId: string) {
  const projectInfo = getProjectDir(settings, datasetId);
  if (!fs.pathExistsSync(projectInfo.basePath)) {
    throw new Error(`missing project directory ${projectInfo.basePath}`);
  }
  fs.ensureDirSync(projectInfo.auxDirAbsPath);
  if (!fs.pathExistsSync(projectInfo.datasetFileAbsPath)) {
    throw new Error(`missing dataset json file ${projectInfo.datasetFileAbsPath}`);
  }
  const { trackFileAbsPath } = await _findJsonAndMetaTrackFile(projectInfo.basePath);
  if (trackFileAbsPath === '') {
    throw new Error(`missing track json file in ${projectInfo.basePath}`);
  }
  return {
    ...projectInfo,
    trackFileAbsPath,
  };
}

/**
 * loadJsonConfig processes dataset configuration from JSON
 * @param configAbsPath a known, existing path
 */
async function loadJsonConfig(configAbsPath: string): Promise<JsonConfig> {
  const configJson = await _loadAsJson(configAbsPath);
  /* check if this file meets the current schema version */
  upgrade(configJson);
  return configJson as JsonConfig;
}

/**
 * loadAnnotationFile load from file
 * @param tracksPath a known, existing path
 */
async function loadAnnotationFile(tracksAbsPath: string): Promise<AnnotationSchema> {
  const annotationData = await _loadAsJson(tracksAbsPath);
  return dive.migrate(annotationData);
}

async function loadConfig(
  settings: Settings,
  datasetId: string,
  makeMediaUrl: (path: string) => string,
): Promise<DesktopConfig> {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonConfig(projectDirData.datasetFileAbsPath);
  const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
  if (cameraName) {
    const hierarchy = await loadCanonicalHierarchy(settings, parentId);
    if (hierarchy === null) {
      delete projectMetaData.typeHierarchy;
    } else {
      projectMetaData.typeHierarchy = hierarchy as Record<string, string>;
    }
  }

  // Load the standalone camera registration (transforms + correspondences)
  // from the per-camera *_registration.json files, if present; the dataset
  // meta fields serve as the import-time seed until a save writes the files.
  let {
    cameraHomographies, cameraCorrespondences, cameraTransformTypes, cameraRegistrationSource,
  } = projectMetaData;
  const loadedCalibration = await loadRegistrationFiles(projectDirData.basePath);
  if (loadedCalibration.found) {
    ({
      homographies: cameraHomographies,
      correspondences: cameraCorrespondences,
      transformTypes: cameraTransformTypes,
      source: cameraRegistrationSource,
    } = loadedCalibration);
  }

  let videoUrl = '';
  let imageData = [] as FrameImage[];
  let multiCamMedia: MultiCamMedia | null = null;
  const { subType } = projectMetaData;
  /* Generate URLs against embedded media server from known file paths on disk */
  if (projectMetaData.type === MultiType) {
    // Returns the type of the defaultDisplay for the multicam
    if (!projectMetaData.multiCam) {
      throw new Error(`Dataset: ${projectMetaData.name} is of type multiCam or stereo but contains no multiCam data`);
    }
    multiCamMedia = getMultiCamUrls(projectMetaData, projectDirData.basePath, makeMediaUrl);
    /* TODO: Done temporarily before we support true display of items */
    const defaultDisplay = multiCamMedia.cameras[multiCamMedia.defaultDisplay];
    imageData = defaultDisplay.imageData;
    videoUrl = defaultDisplay.videoUrl;
  } else if (projectMetaData.type === 'video') {
    /* Use transcoded output only after it exists on disk. */
    if (projectMetaData.transcodedVideoFile) {
      const transcodedVideo = npath.join(projectDirData.basePath, projectMetaData.transcodedVideoFile);
      if (await fs.pathExists(transcodedVideo)) {
        videoUrl = makeMediaUrl(transcodedVideo);
      } else if (projectMetaData.originalBasePath && projectMetaData.originalVideoFile) {
        const originalVideo = npath.join(projectMetaData.originalBasePath, projectMetaData.originalVideoFile);
        videoUrl = makeMediaUrl(originalVideo);
      } else {
        // Some legacy/test metadata only has a transcoded filename.
        videoUrl = makeMediaUrl(transcodedVideo);
      }
    } else {
      const video = npath.join(projectMetaData.originalBasePath, projectMetaData.originalVideoFile);
      videoUrl = makeMediaUrl(video);
    }
  } else if (projectMetaData.type === 'image-sequence') {
    if (projectMetaData.transcodedImageFiles && projectMetaData.transcodedImageFiles.length) {
      imageData = projectMetaData.transcodedImageFiles.map((filename: string) => ({
        url: makeMediaUrl(npath.join(projectDirData.basePath, filename)),
        filename,
        timestamp: parseFrameTimestamp(filename),
      }));
    } else {
      imageData = projectMetaData.originalImageFiles.map((pathOrFilename: string) => {
        const absPath = npath.join(projectMetaData.originalBasePath, pathOrFilename);
        const filename = npath.basename(absPath);
        return {
          url: makeMediaUrl(absPath),
          filename,
          timestamp: parseFrameTimestamp(filename),
        };
      });
    }
  } else if (projectMetaData.type === 'large-image' && projectMetaData.originalLargeImageFile) {
    const tiffPath = npath.join(projectMetaData.originalBasePath, projectMetaData.originalLargeImageFile);
    imageData = [{
      url: makeMediaUrl(tiffPath),
      id: datasetId,
      filename: npath.basename(tiffPath),
    }];
  } else {
    throw new Error(`unexpected project type for id="${datasetId}" type="${projectMetaData.type}"`);
  }
  // Redirecting type to image-sequence or video for multi camera types
  return {
    ...projectMetaData,
    videoUrl,
    imageData,
    multiCamMedia,
    subType,
    cameraHomographies,
    cameraCorrespondences,
    cameraTransformTypes,
    cameraRegistrationSource,
  };
}

async function loadDetections(settings: Settings, datasetId: string) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  return loadAnnotationFile(projectDirData.trackFileAbsPath);
}

/**
 * Frame-metadata read path. Declared frame metadata sidecars are discovered on disk and read here.
 * Parsing and resolving against media filenames happens in the renderer via the shared TypeScript
 * resolver (dive-common/frameMetadata). Nothing derived is persisted; the sidecar the user dropped
 * is the only stored form.
 */
interface FrameMetadataSource {
  originalBasePath: string;
  originalImageFiles?: string[];
  imageListPath?: string;
  originalVideoFile?: string;
}

// Directories that may hold a camera's sidecars: the media base path, the image-list directory,
// and any absolute media paths. Deduped, order-preserving.
function frameMetadataSourceDirectories(source: FrameMetadataSource): string[] {
  const mediaPaths = [
    ...(source.originalImageFiles ?? []),
    ...(source.originalVideoFile ? [source.originalVideoFile] : []),
  ];
  const directories = [
    source.originalBasePath,
    source.imageListPath ? npath.dirname(source.imageListPath) : '',
    // Only absolute media entries reveal extra directories; relative names are
    // resolved against originalBasePath, already covered above.
    ...mediaPaths
      .filter((mediaPath) => npath.isAbsolute(mediaPath))
      .map((mediaPath) => npath.dirname(mediaPath)),
  ];
  // uniq keeps first-occurrence order, so folder precedence (base path first) is preserved.
  return uniq(directories.filter(Boolean).map((directory) => npath.resolve(directory)));
}

const multipleReservedMetadataAttachments = (
  'More than one reserved-name metadata attachment is available.'
);

/**
 * A missing directory, or a media/image-list FILE path where a directory was expected, simply
 * holds no attachment. Every other readdir failure -- an unreadable directory, say -- stays an
 * error: reading it as "nothing here" would report a dataset as having no attachment when its
 * directory could not be read at all.
 */
function noEntriesIfAbsent(err: NodeJS.ErrnoException): never[] {
  if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
    return [];
  }
  throw err;
}

function listNames(directory: string): Promise<string[]> {
  return fs.readdir(directory).catch(noEntriesIfAbsent);
}

async function reservedMetadataAttachmentPaths(directory: string): Promise<string[]> {
  const names = await listNames(directory);
  const candidates = names
    .filter(isFrameMetadataSourceName)
    .map((name) => npath.join(directory, name));
  const files = await Promise.all(candidates.map(async (candidate) => {
    try {
      return (await fs.stat(candidate)).isFile() ? candidate : null;
    } catch {
      return null;
    }
  }));
  return files.filter((candidate): candidate is string => candidate !== null);
}

/**
 * The one reserved-name attachment in a media directory. Reserved-name discovery is only
 * consulted when the user made no explicit choice, so an ambiguous directory is an error only
 * in that case -- matching the server's explicit-then-reserved resolution order.
 */
async function reservedMetadataAttachmentPath(directory: string): Promise<string | undefined> {
  const paths = await reservedMetadataAttachmentPaths(directory);
  if (paths.length > 1) {
    throw new Error(
      `More than one metadata file was found in ${directory}. Keep one and try again.`,
    );
  }
  return paths[0];
}

async function listArchiveMetadataFiles(directory: string): Promise<string[]> {
  const entries: fs.Dirent[] = await fs.readdir(directory, { withFileTypes: true })
    .catch(noEntriesIfAbsent);
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = npath.join(directory, entry.name);
    return entry.isDirectory() ? listArchiveMetadataFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

/**
 * Whether a directory is one scope of an exported dataset. Every export writes a config.json
 * beside the media, and the server twin is only ever reached through
 * `_load_exported_dataset_meta`, which requires one -- so the archive contract below is scoped
 * the same way here. An ordinary media folder that happens to keep its own `metadata/`
 * subdirectory is not an archive and must import untouched.
 */
async function isExportedDatasetDirectory(directory: string): Promise<boolean> {
  return (await listNames(directory)).some((name) => JsonConfigRegEx.test(name));
}

/**
 * The metadata attachment an export archive carries for one dataset directory: the single file
 * under its `metadata/` subdirectory. config.json's contents are never consulted -- a locator
 * stored there would be a path from another machine -- so archives written by any DIVE version,
 * including ones that carry no attachment at all, import the same way. The walk is recursive so
 * an archive rewritten by a tool that nested the file is still imported.
 * Mirrors `_archive_metadata_attachment` in server/dive_tasks/utils.py, error strings included.
 */
async function archiveMetadataAttachment(directory: string): Promise<string | undefined> {
  if (!(await isExportedDatasetDirectory(directory))) {
    return undefined;
  }
  const files = await listArchiveMetadataFiles(npath.join(directory, ArchiveMetadataFolderName));
  if (!files.length) {
    return undefined;
  }
  if (files.length > 1) {
    throw new Error(
      'More than one metadata file was found in the archive metadata directory.'
      + ' Keep one and try again.',
    );
  }
  const [attachment] = files;
  if (!metadataFileTypes.includes(npath.extname(attachment).slice(1).toLowerCase())) {
    throw new Error('Archive metadata attachment must be a JSON, TXT, or CSV file');
  }
  return attachment;
}

/**
 * The attachment a media directory offers on import: an export archive's `metadata/` file
 * first, then a reserved-name file lying beside the media.
 */
async function discoverMetadataAttachment(directory: string): Promise<string | undefined> {
  const archived = await archiveMetadataAttachment(directory);
  return archived ?? reservedMetadataAttachmentPath(directory);
}

/**
 * Discovery for the single-dataset import, where the answer is only the value the import
 * dialog's "Metadata File (Optional)" field opens with. That field is the one place the user
 * can resolve an ambiguous or unreadable directory, and it appears only after this returns, so
 * a discovery failure is reported as an import warning instead of refusing the whole dataset.
 * The multicam path keeps the throw: its per-camera picks are already made when it runs.
 */
async function suggestMetadataAttachment(
  directory: string,
): Promise<{ path?: string; warning?: string }> {
  try {
    return { path: await discoverMetadataAttachment(directory) };
  } catch (err) {
    return { warning: (err as Error).message };
  }
}

async function loadMetadataAttachment(
  projectBasePath: string,
  storedPath: string,
  originalName?: string,
): Promise<FrameMetadataAttachmentText> {
  const absolutePath = npath.resolve(projectBasePath, storedPath);
  const name = originalName || npath.basename(storedPath);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return { name, error: METADATA_ATTACHMENT_UNAVAILABLE };
    }
    if (!isFrameMetadataReadableName(name)) {
      return { name };
    }
    return { name, text: await fs.readFile(absolutePath, 'utf-8') };
  } catch {
    return { name, error: METADATA_ATTACHMENT_UNAVAILABLE };
  }
}

async function reservedMetadataAttachment(
  directories: string[],
): Promise<FrameMetadataAttachmentText | undefined> {
  const resolvedDirectories = uniq(directories.map((directory) => npath.resolve(directory)));
  async function resolveAt(index: number): Promise<FrameMetadataAttachmentText | undefined> {
    const resolved = resolvedDirectories[index];
    if (resolved === undefined) {
      return undefined;
    }
    const paths = await reservedMetadataAttachmentPaths(resolved);
    if (paths.length > 1) {
      return {
        name: 'Metadata File',
        error: multipleReservedMetadataAttachments,
      };
    }
    if (paths.length === 1) {
      return loadMetadataAttachment(resolved, paths[0]);
    }
    return resolveAt(index + 1);
  }
  return resolveAt(0);
}

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function commonParentDirectory(paths: string[]): string | null {
  const resolved = paths.filter((item) => item).map((item) => npath.resolve(item));
  if (!resolved.length) {
    return null;
  }
  const [first, ...rest] = resolved;
  const firstParts = first.split(npath.sep);
  let { length } = firstParts;
  rest.forEach((candidate) => {
    const parts = candidate.split(npath.sep);
    length = Math.min(length, parts.length);
    for (let i = 0; i < length; i += 1) {
      if (firstParts[i] !== parts[i]) {
        length = i;
        break;
      }
    }
  });
  const prefix = firstParts.slice(0, length).join(npath.sep);
  // Return null rather than the filesystem root when cameras share no common prefix,
  // so an unrelated-mount multicam never scans every sidecar at '/'.
  return prefix || null;
}

async function loadMulticamFrameMetadata(
  projectBasePath: string,
  projectMetaData: JsonConfig,
): Promise<FrameMetadataSourcesResponse> {
  const { multiCam } = projectMetaData;
  if (!multiCam) {
    return { cameras: {} };
  }

  const cameraEntries = orderedMultiCamCameraNames({
    cameras: multiCam.cameras,
    defaultDisplay: multiCam.defaultDisplay,
  }).map((cameraName) => [cameraName, multiCam.cameras[cameraName]] as const);

  // originalBasePath is a directory for folder imports but a media/image-list FILE path for
  // keyword imports, so fall back to the cameras' shared parent unless it is really a directory.
  const rootDirectory = await isExistingDirectory(projectMetaData.originalBasePath)
    ? projectMetaData.originalBasePath
    : commonParentDirectory(cameraEntries.flatMap(([, camera]) => (
      frameMetadataSourceDirectories(camera)
    )));
  const resolvedRoot = rootDirectory ? npath.resolve(rootDirectory) : null;
  const shared = projectMetaData.metadataFile
    ? await loadMetadataAttachment(
      projectBasePath,
      projectMetaData.metadataFile,
      projectMetaData.metadataOriginalName,
    )
    : await reservedMetadataAttachment(rootDirectory ? [rootDirectory] : []);

  const cameras: FrameMetadataSourcesResponse['cameras'] = {};

  await Promise.all(cameraEntries.map(async ([cameraName, cameraMeta]) => {
    if (cameraMeta.type !== 'image-sequence' && cameraMeta.type !== 'video') {
      return;
    }
    if (cameraMeta.metadataFile) {
      cameras[cameraName] = await loadMetadataAttachment(
        projectBasePath,
        cameraMeta.metadataFile,
        cameraMeta.metadataOriginalName,
      );
      return;
    }
    // A camera-local reserved-name attachment stands on its own: the dataset-level attachment
    // never suppresses it, however the shared one was declared.
    const localDirectories = frameMetadataSourceDirectories(cameraMeta)
      .filter((directory) => resolvedRoot === null || directory !== resolvedRoot);
    const local = await reservedMetadataAttachment(localDirectories);
    if (local) {
      cameras[cameraName] = local;
    }
  }));

  return {
    ...(shared ? { shared } : {}),
    cameras,
  };
}

async function loadFrameMetadata(
  settings: Settings,
  datasetId: string,
): Promise<FrameMetadataSourcesResponse> {
  const parentId = parentDatasetId(datasetId);
  const projectDirData = await getValidatedProjectDir(settings, parentId);
  const projectMetaData = await loadJsonConfig(projectDirData.datasetFileAbsPath);

  if (projectMetaData.type === MultiType) {
    return loadMulticamFrameMetadata(projectDirData.basePath, projectMetaData);
  }
  if (projectMetaData.type !== 'image-sequence' && projectMetaData.type !== 'video') {
    return { cameras: {} };
  }

  const shared = projectMetaData.metadataFile
    ? await loadMetadataAttachment(
      projectDirData.basePath,
      projectMetaData.metadataFile,
      projectMetaData.metadataOriginalName,
    )
    : await reservedMetadataAttachment(frameMetadataSourceDirectories(projectMetaData));
  return {
    ...(shared ? { shared } : {}),
    cameras: {},
  };
}

/**
 * Look through DIVE project path, find subfolders that
 * look like datasets, and return them.
 */
async function autodiscoverData(settings: Settings): Promise<JsonConfig[]> {
  const dspath = npath.join(settings.dataPath, ProjectsFolderName);
  const dsids = await fs.readdir(dspath);
  const metas: JsonConfig[] = [];
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < dsids.length; i += 1) {
    const datasetId = dsids[i];
    try {
      const projectDirData = await getValidatedProjectDir(settings, datasetId);
      const metadata = await loadJsonConfig(projectDirData.datasetFileAbsPath);
      metas.push(metadata);
    } catch {
      // noop, dataset was invalid
    }
  }
  /* eslint-enable */
  return metas;
}

/**
 * Get all runnable pipelines
 * @param settings app settings
 */
async function getPipelineList(settings: Settings): Promise<Pipelines> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const allowedPatterns = /^filter_.+|^transcode_.+|^detector_.+|^tracker_.+|^generate_.+|^utility_|^measurement_.+|.*[2,3]-cam.+/;
  const disallowedPatterns = /.*local.*|common_stereo_.*|detector_svm_models.pipe|tracker_svm_models.pipe/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) return {};
  let pipes = await fs.readdir(pipelinePath);
  pipes = pipes.filter((p) => p.match(allowedPatterns) && !p.match(disallowedPatterns));

  /* TODO: fetch trained pipelines */
  const ret: Pipelines = {};

  await Promise.all(pipes.map(async (p) => {
    const parts = cleanString(p.replace('.pipe', '')).split('_');
    let pipeType = parts[0];
    let pipeName = parts.slice(1).join(' ');
    // Extract out only 2-cam and 3-cam pipelines to own category, 1-cam remain in tracker/detector
    if (parts.length > 1 && parts[parts.length - 1] === 'cam' && parts[parts.length - 2] !== '1') {
      pipeType = `${parts[parts.length - 2]}-cam`;
      pipeName = parts.join(' ');
    }

    // Extract description and metadata from the pipe file
    const pipeFilePath = npath.join(pipelinePath, p);
    const metadata = await extractPipeMetadata(pipeFilePath);

    const pipeInfo: Pipe = {
      name: pipeName,
      type: pipeType,
      pipe: p,
      metadata,
    };
    if (pipeType in ret) {
      ret[pipeType].pipes.push(pipeInfo);
    } else {
      ret[pipeType] = {
        pipes: [pipeInfo],
        description: '',
      };
    }
  }));

  // Now lets add to it the trained pipelines by recursively looking in the dir
  const allowedTrainedPatterns = new RegExp([
    '^detector.+',
    '^tracker.+',
    '^generate.+',
    '^.*\\.zip',
    '^.*\\.svm',
    '^.*\\.lbl',
    '^.*\\.cfg',
    '^.*\\.yaml',
  ].join('|'));
  const trainedPipelinePath = npath.join(settings.dataPath, PipelinesFolderName);
  const trainedExists = await fs.pathExists(trainedPipelinePath);
  if (!trainedExists) return ret;
  const trainedPipeFolders = await fs.readdir(trainedPipelinePath);
  await Promise.all(trainedPipeFolders.map(async (item) => {
    const pipeFolder = npath.join(trainedPipelinePath, item);
    const pipeFolderExists = await fs.pathExists(pipeFolder);
    if (!pipeFolderExists) return false;
    let pipesInFolder = await fs.readdir(pipeFolder);
    pipesInFolder = pipesInFolder.filter(
      (p: string) => p.match(allowedTrainedPatterns) && !p.match(disallowedPatterns),
    );
    if (pipesInFolder.length >= 2) {
      const pipeName = pipesInFolder.find((pipe) => pipe && pipe.indexOf('.pipe') !== -1);
      if (pipeName) {
        const pipeInfo = {
          name: item,
          type: 'trained',
          pipe: npath.join(pipeFolder, pipeName),
        };
        if ('trained' in ret) {
          ret.trained.pipes.push(pipeInfo);
        } else {
          ret.trained = {
            pipes: [pipeInfo],
            description: 'trained pipes',
          };
        }
      }
    }
    return true;
  }));
  return ret;
}

// Function to recursively traverse a directory and collect files with specified extensions
function getFilesWithExtensions(dir: string, extensions: string[], fileList: string[] = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = npath.join(dir, file);
    const fileStat = fs.statSync(filePath);

    if (fileStat.isDirectory()) {
      fileList.concat(getFilesWithExtensions(filePath, extensions, fileList));
    } else {
      const fileExtension = npath.extname(file).toLowerCase();
      if (extensions.includes(fileExtension)) {
        fileList.push(filePath);
      }
    }
  });

  return fileList;
}

/**
 * get training configurations
 */
async function getTrainingConfigs(settings: Settings): Promise<TrainingConfigs> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const defaultTrainingConfiguration = 'train_detector_default.conf';
  const allowedPatterns = /train_.*\.conf$/;
  const disallowedPatterns = /.*(_nf|\.continue)\.viame_csv\.conf$/;
  const allowedModelExtensions = ['.zip', '.pth', '.pt', '.py', '.weights', '.wt'];
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) {
    throw new Error(`Path does not exist: ${pipelinePath}`);
  }
  let configNames = await fs.readdir(pipelinePath);
  configNames = configNames
    .filter((p) => (p.match(allowedPatterns) && !p.match(disallowedPatterns)))
    .sort((a, b) => (a === defaultTrainingConfiguration ? -1 : a.localeCompare(b)));

  const configs: TrainingConfig[] = await Promise.all(configNames.map(async (name) => {
    const configFilePath = npath.join(pipelinePath, name);
    const { description } = (await extractPipeMetadata(configFilePath));
    return { name, description };
  }));

  // Get Model files in the pipeline directory
  const modelList = getFilesWithExtensions(pipelinePath, allowedModelExtensions);
  const models: TrainingConfigs['models'] = {};
  modelList.forEach((model) => {
    models[npath.basename(model)] = {
      name: npath.basename(model),
      type: npath.extname(model),
      path: model,
    };
  });
  return {
    training: {
      default: configNames[0],
      configs,
    },
    models,
  };
}

/**
 * delete a trained pipeline
 */
async function deleteTrainedPipeline(pipeline: Pipe): Promise<void> {
  if (pipeline.type !== 'trained') throw new Error(`${pipeline.name} is not a trained pipeline`);

  const parent = npath.parse(pipeline.pipe).dir;
  await fs.remove(parent);
}

/**
 * _saveSerialized save pre-serialized tracks to disk
 */
async function _saveSerialized(
  settings: Settings,
  datasetId: string,
  data: AnnotationSchema,
  allowEmpty = false,
) {
  const time = moment().format('MM-DD-YYYY_hh-mm-ss.SSS');
  const newFileName = `result_${time}.json`;
  const projectInfo = getProjectDir(settings, datasetId);
  const release = await _acquireLock(projectInfo.basePath, projectInfo.basePath, 'tracks');

  try {
    const validatedInfo = await getValidatedProjectDir(settings, datasetId);
    await fs.move(
      validatedInfo.trackFileAbsPath,
      npath.join(
        validatedInfo.auxDirAbsPath,
        npath.basename(validatedInfo.trackFileAbsPath),
      ),
    );
  } catch (err) {
    // Some part of the project dir didn't exist
    if (!allowEmpty) throw err;
  }
  const serialized = JSON.stringify(data);
  await fs.writeFile(npath.join(projectInfo.basePath, newFileName), serialized);
  await release();
}

/**
 * Save detections to json file in aux
 */
async function saveDetections(settings: Settings, datasetId: string, args: SaveDetectionsArgs) {
  /* Update existing track file */
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const existing = await loadAnnotationFile(projectDirInfo.trackFileAbsPath);
  function _save(type: 'tracks' | 'groups') {
    args[type].delete.forEach((id) => delete existing[type][id.toString()]);
    args[type].upsert.forEach((val: TrackData | GroupData) => {
      existing[type][val.id.toString()] = val;
    });
  }
  _save('tracks');
  _save('groups');
  return _saveSerialized(settings, datasetId, existing);
}

/**
 * _saveAsJson saves directly to disk
 */
async function _saveAsJson(absPath: string, data: unknown) {
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(absPath, serialized);
}

/**
 * Write the project dataset file as dataset.json and remove a legacy
 * meta.json if one was present, so there is only one source of truth.
 */
async function saveProjectConfig(basePath: string, data: unknown) {
  const preferred = npath.join(basePath, DatasetFileName);
  const legacy = npath.join(basePath, DatasetFileNameLegacy);
  await _saveAsJson(preferred, data);
  if (await fs.pathExists(legacy)) {
    await fs.remove(legacy);
  }
}

async function saveConfig(settings: Settings, datasetId: string, args: DatasetConfigMutable) {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  // Lock the project directory (same pattern as tracks). Locking dataset.json
  // directly fails with ENOENT on legacy projects that still only have
  // meta.json, and migrate-on-save below may remove the legacy file while the
  // lock is held.
  const release = await _acquireLock(
    projectDirInfo.basePath,
    projectDirInfo.basePath,
    'meta',
  );
  try {
    const existing = await loadJsonConfig(
      resolveDatasetFileAbsPath(projectDirInfo.basePath),
    );
    const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
    const hierarchyPresent = Object.prototype.hasOwnProperty.call(args, 'typeHierarchy');
    if (cameraName) {
      if (hierarchyPresent) {
        await saveConfig(settings, parentId, { typeHierarchy: args.typeHierarchy });
      }
      delete existing.typeHierarchy;
    }
    let hierarchyWrite: HierarchyWrite;
    try {
      hierarchyWrite = resolveTypeHierarchy(
        existing.typeHierarchy,
        !cameraName && hierarchyPresent,
        args.typeHierarchy,
        'save',
      );
    } catch (error) {
      if (error instanceof TypeHierarchyError) {
        throw new Error(invalidHierarchyMessage(error.reason));
      }
      throw error;
    }
    if (hierarchyWrite.action === 'set') {
      existing.typeHierarchy = { ...hierarchyWrite.hierarchy };
    } else if (hierarchyWrite.action === 'delete') {
      delete existing.typeHierarchy;
    }
    if (args.confidenceFilters) {
      existing.confidenceFilters = args.confidenceFilters;
    }
    if (args.imageEnhancements) {
      existing.imageEnhancements = args.imageEnhancements;
    }
    if (args.customTypeStyling) {
      existing.customTypeStyling = args.customTypeStyling;
    }
    if (args.customGroupStyling) {
      existing.customGroupStyling = args.customGroupStyling;
    }
    if (args.attributes) {
      existing.attributes = args.attributes;
    }
    if (args.timeFilters !== undefined) {
      existing.timeFilters = args.timeFilters;
    }
    if (args.error) {
      existing.error = args.error;
    }
    if (args.datasetInfo) {
      existing.datasetInfo = args.datasetInfo;
    }

    // Registration files remain separate so each camera pair has one persisted owner.
    if (args.cameraHomographies || args.cameraCorrespondences || args.cameraTransformTypes
      || args.cameraRegistrationSource) {
      await saveRegistrationToDatasetDir(
        projectDirInfo.basePath,
        args,
        referenceCameraName(existing),
      );
    }

    await saveProjectConfig(projectDirInfo.basePath, existing);
  } finally {
    await release();
  }
}

async function saveAttributes(settings: Settings, datasetId: string, args: SaveAttributeArgs) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonConfig(projectDirData.datasetFileAbsPath);
  if (!projectMetaData.attributes) {
    projectMetaData.attributes = {};
  }
  args.delete.forEach((attributeId) => {
    if (projectMetaData.attributes && projectMetaData.attributes[attributeId]) {
      delete projectMetaData.attributes[attributeId];
    }
  });
  args.upsert.forEach((attribute) => {
    if (projectMetaData.attributes) {
      projectMetaData.attributes[attribute.key] = attribute;
    }
  });
  await saveConfig(settings, datasetId, projectMetaData);
}

async function saveAttributeTrackFilters(
  settings: Settings,
  datasetId: string,
  args: SaveAttributeTrackFilterArgs,
) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonConfig(projectDirData.datasetFileAbsPath);
  if (!projectMetaData.attributeTrackFilters) {
    projectMetaData.attributeTrackFilters = {};
  }
  args.delete.forEach((filterId) => {
    if (projectMetaData.attributeTrackFilters && projectMetaData.attributeTrackFilters[filterId]) {
      delete projectMetaData.attributeTrackFilters[filterId];
    }
  });
  args.upsert.forEach((filter) => {
    if (projectMetaData.attributeTrackFilters) {
      projectMetaData.attributeTrackFilters[filter.name] = filter;
    }
  });
  await saveConfig(settings, datasetId, projectMetaData);
}

async function _ingestFilePath(
  settings: Settings,
  plan: IngestFilePlan,
  imageMap: Map<string, number> | undefined,
): Promise<[
  (DatasetConfigMutable & { fps?: number }), string[], boolean, string,
] | null> {
  const {
    datasetId, path, additive, additivePrepend, configMeta, cocoHierarchy,
  } = plan;
  if (!fs.existsSync(path)) {
    return null;
  }
  if (fs.statSync(path).size === 0) {
    return null;
  }
  // Frame-metadata sidecars are read from the media folder, so importing one as annotations would
  // copy it into the wrong storage path.
  if (isFrameMetadataSourceName(path)) {
    throw new Error(`${npath.basename(path)} is a frame metadata file. Place it in the dataset's media folder; it cannot be imported as annotations.`);
  }
  let warnings: string[] = [];
  // Make a copy of the file in aux
  const projectInfo = getProjectDir(settings, datasetId);
  const newPath = npath.join(projectInfo.auxDirAbsPath, `imported_${npath.basename(path)}`);
  await fs.copy(path, newPath);
  // Attempt to process the file
  let annotations = dive.makeEmptyAnnotationFile();
  const meta: DatasetConfigMutable & { fps?: number, execTime?: number } = {};
  let metadataConfig = false;
  if (configMeta) {
    Object.assign(meta, configMeta);
    metadataConfig = true;
  } else if (JsonFileName.test(path)) {
    const jsonObject = await _loadAsJson(path);
    if (nistSerializers.confirmNistFormat(jsonObject)) {
      // NIST json file
      const data = await nistSerializers.loadNistFile(path);
      annotations.tracks = data.tracks;
      annotations.groups = data.groups;
      meta.fps = data.fps;
    } else if (coco.isCocoJson(jsonObject)) {
      const [parsedAnnotations, parsedMeta, cocoWarnings] = await coco.parseFile(path);
      annotations = parsedAnnotations;
      merge(meta, parsedMeta);
      if (cocoHierarchy) {
        meta.typeHierarchy = { ...cocoHierarchy };
      }
      warnings = warnings.concat(cocoWarnings);
    } else {
      // Regular dive json
      annotations = await loadAnnotationFile(path);
    }
  } else if (CsvFileName.test(path)) {
    // VIAME CSV File
    let data: Awaited<ReturnType<typeof viameSerializers.parseFile>>;
    try {
      data = await viameSerializers.parseFile(path, imageMap);
    } catch (e) {
      // A plain CSV that fails to parse as annotations is often frame metadata. Desktop has no
      // in-viewer frame metadata import, so the rename convention is the only remedy to offer.
      throw new Error(`${(e as Error).message} If this file is frame metadata rather than annotations, rename it to frame-metadata.csv and place it in the dataset's media folder.`);
    }
    annotations.tracks = data[0].tracks;
    annotations.groups = data[0].groups;
    meta.fps = data[0].fps;
    meta.execTime = data[0].execTime;
    if (data[0].datasetInfo) {
      meta.datasetInfo = data[0].datasetInfo;
    }
    [, warnings] = data;
  } else if (YAMLFileName.test(path)) {
    annotations = await kpf.parse([path]);
  }
  // If it is additive we need to re-ID tracks and do additive prepends
  if (additive) {
    // Load previous data
    const existing = await loadDetections(settings, datasetId);
    const { tracks } = existing;
    let maxTrackId = -1;
    Object.values(tracks).forEach((item) => {
      maxTrackId = Math.max(item.id, maxTrackId);
    });
    maxTrackId += 1;
    const newTracks = Object.values(annotations.tracks);
    for (let i = 0; i < newTracks.length; i += 1) {
      const newTrack = newTracks[i];
      newTrack.id += maxTrackId;
      if (additivePrepend !== '') {
        const { confidencePairs } = newTrack;
        for (let k = 0; k < confidencePairs.length; k += 1) {
          confidencePairs[k] = [`${additivePrepend}_${confidencePairs[k][0]}`, confidencePairs[k][1]];
        }
        newTrack.confidencePairs = confidencePairs;
      }
      existing.tracks[newTrack.id] = newTrack;
    }
    annotations.tracks = existing.tracks;
  }

  if (Object.values(annotations.tracks).length || Object.values(annotations.groups).length) {
    const processed = processTrackAttributes(Object.values(annotations.tracks));
    meta.attributes = processed.attributes;
  }
  if (!metadataConfig) { // Only save Annotations when not a metadata Config file
    await _saveSerialized(settings, datasetId, annotations, true);
  }

  return [meta, warnings, metadataConfig, newPath];
}

type StagedConfigImport = DatasetConfigMutable & { fps?: number };

interface IngestFilePlan {
  datasetId: string;
  path: string;
  additive: boolean;
  additivePrepend: string;
  configMeta?: StagedConfigImport;
  cocoHierarchy?: Record<string, string>;
  configWarnings?: string[];
}

async function loadCanonicalHierarchy(settings: Settings, datasetId: string): Promise<unknown> {
  const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
  const canonicalId = cameraName ? parentId : datasetId;
  const projectDir = getProjectDir(settings, canonicalId);
  if (!await fs.pathExists(projectDir.datasetFileAbsPath)) {
    return null;
  }
  const config = await loadJsonConfig(projectDir.datasetFileAbsPath);
  return Object.prototype.hasOwnProperty.call(config, 'typeHierarchy')
    ? config.typeHierarchy
    : null;
}

function mergeImportedConfig(
  target: DatasetConfigMutable,
  incoming: DatasetConfigMutable,
) {
  const hierarchyPresent = Object.prototype.hasOwnProperty.call(incoming, 'typeHierarchy');
  const hierarchy = incoming.typeHierarchy;
  const nonHierarchy = { ...incoming };
  delete nonHierarchy.typeHierarchy;
  merge(target, nonHierarchy);
  if (hierarchyPresent) {
    if (hierarchy === null) {
      // eslint-disable-next-line no-param-reassign
      delete target.typeHierarchy;
    } else {
      // eslint-disable-next-line no-param-reassign
      target.typeHierarchy = hierarchy ? { ...hierarchy } : hierarchy;
    }
  }
}

function mergeStagedImportedConfig(
  target: DatasetConfigMutable,
  incoming: DatasetConfigMutable,
  additive: boolean,
) {
  const hierarchyPresent = Object.prototype.hasOwnProperty.call(incoming, 'typeHierarchy');
  const hierarchy = incoming.typeHierarchy;
  const nonHierarchy = { ...incoming };
  delete nonHierarchy.typeHierarchy;
  const { datasetInfo } = nonHierarchy;
  delete nonHierarchy.datasetInfo;
  merge(target, nonHierarchy);
  if (datasetInfo) {
    // eslint-disable-next-line no-param-reassign
    target.datasetInfo = additive
      ? { ...(target.datasetInfo || {}), ...datasetInfo }
      : datasetInfo;
  }
  if (hierarchyPresent) {
    // eslint-disable-next-line no-param-reassign
    target.typeHierarchy = hierarchy === null ? null : { ...hierarchy };
  }
}

async function preflightIngestFiles(
  settings: Settings,
  datasetId: string,
  absPaths: string[],
  multiCamResults: Record<string, string> | undefined,
  additive: boolean,
  additivePrepend: string,
): Promise<IngestFilePlan[]> {
  let hierarchyCandidate = await loadCanonicalHierarchy(settings, datasetId);
  const plan: IngestFilePlan[] = [
    ...absPaths.map((path) => ({
      datasetId,
      path,
      additive,
      additivePrepend,
    })),
    ...Object.entries(multiCamResults || {}).map(([cameraName, path]) => ({
      datasetId: `${datasetId}/${cameraName}`,
      path,
      additive: false,
      additivePrepend: '',
    })),
  ];
  for (let index = 0; index < plan.length; index += 1) {
    const entry = plan[index];
    const { path } = entry;
    if (fs.existsSync(path) && fs.statSync(path).size > 0 && JsonFileName.test(path)) {
      // Configuration entries keep their parsed, fully resolved metadata in this
      // plan so execution cannot re-read the source or repeat hierarchy policy.
      let jsonObject;
      try {
        // eslint-disable-next-line no-await-in-loop
        jsonObject = await _loadAsJson(path);
      } catch (error) {
        if (error instanceof DataFileJsonParseError) {
          // Defer syntax failures so earlier annotations retain ordered partial writes.
          jsonObject = undefined;
        } else {
          throw error;
        }
      }
      if (jsonObject !== undefined
        && jsonObject !== null
        && typeof jsonObject === 'object'
        && !Array.isArray(jsonObject)
        && !nistSerializers.confirmNistFormat(jsonObject)
        && DatasetConfigMutableKeys.some((key) => key in jsonObject)) {
        try {
          const configMeta = pick(
            jsonObject,
            DatasetConfigMutableKeys,
          ) as StagedConfigImport;
          const write = resolveTypeHierarchy(
            hierarchyCandidate,
            Object.prototype.hasOwnProperty.call(jsonObject, 'typeHierarchy'),
            jsonObject.typeHierarchy,
            additive ? 'additive' : 'overwrite',
          );
          delete configMeta.typeHierarchy;
          if (write.action === 'set') {
            hierarchyCandidate = write.hierarchy;
            configMeta.typeHierarchy = { ...write.hierarchy };
          } else if (write.action === 'delete') {
            hierarchyCandidate = null;
            configMeta.typeHierarchy = null;
          }
          entry.configMeta = configMeta;
        } catch (error) {
          if (error instanceof TypeHierarchyError) {
            throw new Error(invalidHierarchyMessage(error.reason));
          }
          throw error;
        }
      } else if (jsonObject !== undefined && coco.isCocoJson(jsonObject)) {
        const { hierarchy, warnings } = coco.typeHierarchyFromCategories(jsonObject);
        entry.configWarnings = warnings;
        if (hierarchy !== undefined) {
          try {
            const write = resolveTypeHierarchy(
              hierarchyCandidate ?? null,
              true,
              hierarchy,
              'additive',
            );
            if (write.action === 'set') {
              hierarchyCandidate = write.hierarchy;
              entry.cocoHierarchy = { ...write.hierarchy };
            }
          } catch (error) {
            if (!(error instanceof TypeHierarchyError)) {
              throw error;
            }
            entry.configWarnings = entry.configWarnings.concat(
              coco.invalidCocoHierarchyMessage(error.reason),
            );
          }
        }
      }
    }
  }
  return plan;
}

/**
 * ingestDataFiles imports data from external annotation formats
 * given a list of candidate file paths.
 *
 * SUPPORTED FORMATS:
 * VIAME CSV
 *
 * @param paths paths to possible input annotation files
 * @param datasetId dataset id path
 * @param absPaths list of paths to check for annotation files
 * @param multiCamResults Objec where the keys are Camera names
 * and the value is the path to a result file
 */
async function ingestDataFiles(
  settings: Settings,
  datasetId: string,
  absPaths: string[],
  multiCamResults?: Record<string, string>,
  imageMap?: Map<string, number>,
  additive = false,
  additivePrepend = '',
): Promise<{
  processedFiles: string[];
  meta: DatasetConfigMutable & { fps?: number };
  warnings: string[];
}> {
  const processedFiles = []; // which files were processed to generate the detections
  const meta: DatasetConfigMutable & { fps?: number } = {};
  let outwarnings: string[] = [];
  const plan = await preflightIngestFiles(
    settings,
    datasetId,
    absPaths,
    multiCamResults,
    additive,
    additivePrepend,
  );
  const importedConfigCopies: string[] = [];
  try {
    for (let i = 0; i < plan.length; i += 1) {
      const entry = plan[i];
      // eslint-disable-next-line no-await-in-loop
      const results = await _ingestFilePath(
        settings,
        entry,
        imageMap,
      );
      if (results !== null) {
        const [newMeta, warnings, metadataConfig, auxiliaryPath] = results;
        outwarnings = outwarnings.concat(warnings, entry.configWarnings || []);
        mergeStagedImportedConfig(meta, newMeta, additive);
        if (metadataConfig) {
          importedConfigCopies.push(auxiliaryPath);
        }
        processedFiles.push(entry.path);
      }
    }
  } catch (error) {
    await Promise.all(importedConfigCopies.map((path) => fs.remove(path)));
    throw error;
  }

  return { processedFiles, meta, warnings: outwarnings };
}
/**
 * Need to take the trained pipeline if it exists and place it in the DIVE_Pipelines folder
 */
async function processTrainedPipeline(settings: Settings, args: RunTraining, workingDir: string) {
  //Look for trained_detector.zip and detector.pipe and move them to DIVE_Pipelines folder
  const allowedPatterns = /^detector.+|^tracker.+|^generate.+/;
  const trainedDir = npath.join(workingDir, '/category_models');
  const exists = await fs.pathExists(trainedDir);
  if (!exists) {
    throw new Error(`Path: ${trainedDir} does not exist`);
  }
  const folderContents = await fs.readdir(trainedDir);
  const pipes = folderContents.filter((p) => p.match(allowedPatterns));

  if (!pipes.length) {
    throw new Error(`Could not located trained pipe file inside of ${trainedDir}`);
  }
  const baseFolder = npath.join(settings.dataPath, PipelinesFolderName);
  if (!fs.existsSync(baseFolder)) {
    await fs.mkdir(baseFolder);
  }

  const folderName = npath.join(baseFolder, args.pipelineName);
  if (!fs.existsSync(folderName)) {
    await fs.mkdir(folderName);
  }
  //Move detector and model to the new folder
  await Promise.all(folderContents.map(async (item) => {
    const abspath = npath.join(trainedDir, item);
    const destpath = npath.join(folderName, item);
    await fs.move(abspath, destpath, { overwrite: true });
  }));
  return folderContents;
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find prior training runs whose intermediate files are still on disk and can
 * be continued with `viame train --continue`: runs that were interrupted by a
 * crash, a cancellation, or the app shutting down, or that exited early
 * without producing a model.
 */
async function findResumableTrainingJobs(settings: Settings): Promise<DesktopJob[]> {
  const jobsDir = npath.join(settings.dataPath, JobsFolderName);
  if (!fs.existsSync(jobsDir)) {
    return [];
  }
  const results: DesktopJob[] = [];
  const entries = await fs.readdir(jobsDir);
  await Promise.all(entries.map(async (entry) => {
    const workingDir = npath.join(jobsDir, entry);
    try {
      const manifest = await fs.readJson(
        npath.join(workingDir, DiveJobManifestName),
      ) as DesktopJob;
      if (manifest.jobType !== 'training') return;
      if (manifest.exitCode === 0) return;
      if (manifest.endTime === undefined && processIsRunning(manifest.pid)) return;
      // The trainer's intermediate state and the original input lists must survive
      const required = ['deep_training', 'input_folder_list.txt', 'input_truth_list.txt'];
      if (!required.every((f) => fs.existsSync(npath.join(workingDir, f)))) return;
      // Manifests predating final-status recording never carry an end time; a
      // successful run's models were moved out of category_models, leaving it empty
      if (manifest.endTime === undefined) {
        const modelsDir = npath.join(workingDir, 'category_models');
        if (fs.existsSync(modelsDir) && (await fs.readdir(modelsDir)).length === 0) return;
      }
      // The jobs folder may have been relocated since the manifest was written
      results.push({ ...manifest, workingDir });
    } catch {
      // not a job directory or unreadable manifest
    }
  }));
  return results.sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
}

async function discardResumableTraining(settings: Settings, workingDir: string): Promise<void> {
  const jobsDir = npath.resolve(settings.dataPath, JobsFolderName);
  const resolved = npath.resolve(workingDir);
  if (npath.dirname(resolved) !== jobsDir) {
    throw new Error(`${workingDir} is not a job working directory`);
  }
  await fs.remove(resolved);
}

async function _initializeAppDataDir(settings: Settings) {
  await fs.ensureDir(settings.dataPath);
  await fs.ensureDir(npath.join(settings.dataPath, ProjectsFolderName));
  await fs.ensureDir(npath.join(settings.dataPath, JobsFolderName));
}

/**
 * Initialize a new project directory
 * @returns absolute path to new project directory
 */
async function _initializeProjectDir(settings: Settings, jsonConfig: JsonConfig): Promise<string> {
  const projectDir = npath.join(settings.dataPath, ProjectsFolderName, jsonConfig.id);
  await _initializeAppDataDir(settings);
  await fs.ensureDir(projectDir);
  return projectDir;
}

async function deleteDataset(
  settings: Settings,
  datasetId: string,
): Promise<boolean> {
  /* Incomplete or corrupt projects must still be removable, so this
   * deliberately skips getValidatedProjectDir() */
  const projectDirInfo = getProjectDir(settings, datasetId);
  const projectsDir = npath.resolve(settings.dataPath, ProjectsFolderName);
  const basePath = npath.resolve(projectDirInfo.basePath);
  if (!basePath.startsWith(projectsDir + npath.sep)) {
    throw new Error(`${datasetId} is not a dataset directory`);
  }
  if (!await fs.pathExists(basePath)) {
    return true;
  }
  let projectMetaData: JsonConfig | undefined;
  try {
    projectMetaData = await loadJsonConfig(projectDirInfo.datasetFileAbsPath);
  } catch {
    // unreadable dataset json, delete the project directory anyway
  }
  await fs.remove(basePath);
  // If the dataset source is inside DIVE_Jobs_Output, delete that output folder
  if (projectMetaData?.originalBasePath) {
    const jobsOutputPath = npath.resolve(settings.dataPath, JobsOutputFolderName);
    const originalBasePath = npath.resolve(projectMetaData.originalBasePath);
    const isInsideJobsOutput = originalBasePath !== jobsOutputPath
      && originalBasePath.startsWith(jobsOutputPath + npath.sep);
    if (isInsideJobsOutput && await fs.pathExists(originalBasePath)) {
      await fs.remove(originalBasePath);
    }
  }

  return true;
}

async function checkDataset(
  settings: Settings,
  datasetId: string,
): Promise<boolean> {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonConfig(projectDirData.datasetFileAbsPath);
  if (projectMetaData.originalBasePath !== '') {
    const exists = await fs.pathExists(projectMetaData.originalBasePath);
    if (!exists) {
      throw new Error(`Dataset ${projectMetaData.name} does not contain source files at ${projectMetaData.originalBasePath}`);
    }
  }
  if (projectMetaData.error && projectMetaData.error !== '') {
    throw new Error(`Dataset ${projectMetaData.name} contains error: ${projectMetaData.error}`);
  }
  return true;
}

async function findTrackandMetaFileinFolder(path: string) {
  const results = await _findJsonAndMetaTrackFile(path);
  let { trackFileAbsPath } = results;
  const { configFileAbsPath } = results;
  if (!trackFileAbsPath) {
    // Declared frame metadata sidecars stay in place for read-time discovery; the first
    // remaining CSV is unconditionally the annotation track file.
    const csvFileCandidates = (await _findCSVTrackFiles(path))
      .filter((candidate) => !isFrameMetadataSourceName(candidate));
    if (csvFileCandidates.length) {
      [trackFileAbsPath] = csvFileCandidates;
    }
  }
  return { trackFileAbsPath, configFileAbsPath };
}

/**
 * List immediate child directories of a parent folder (for multicam subfolder import).
 */
async function listImmediateSubfolders(parentPath: string): Promise<string[]> {
  if (!await fs.pathExists(parentPath)) {
    throw new Error(`Directory not found: ${parentPath}`);
  }
  const stat = await fs.stat(parentPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${parentPath}`);
  }
  const children = await fs.readdir(parentPath, { withFileTypes: true });
  return children
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
}

function isVideoFilePath(filePath: string): boolean {
  const mimetype = mime.lookup(filePath);
  if (mimetype && (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype))) {
    return true;
  }
  const ext = npath.extname(filePath).replace(/^\./, '').toLowerCase();
  return fileVideoTypes.includes(ext);
}

/**
 * Return true when a subfolder contains at least one importable image or video file.
 */
async function subfolderContainsMedia(
  subfolderPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<boolean> {
  if (!await fs.pathExists(subfolderPath)) {
    return false;
  }
  const stat = await fs.stat(subfolderPath);
  if (!stat.isDirectory()) {
    return mediaType === 'video' && isVideoFilePath(subfolderPath);
  }
  if (mediaType === 'image-sequence') {
    const found = await findImagesInFolder(subfolderPath);
    return found.imagePaths.length > 0;
  }
  const entries = await fs.readdir(subfolderPath, { withFileTypes: true });
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry.isFile()) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const fullPath = npath.join(subfolderPath, entry.name);
    if (isVideoFilePath(fullPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Discover cameras under a parent folder: immediate subfolders, or separate video files
 * in the parent when importing video and there are no subfolders.
 * Subfolders without importable media (e.g. calibration or transform data) are skipped.
 */
async function listParentFolderCameras(
  parentPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<{ name: string; sourcePath: string }[]> {
  const subfolders = await listImmediateSubfolders(parentPath);
  const separator = parentPath.includes('\\') ? '\\' : '/';
  const normalized = parentPath.replace(/[\\/]+$/, '');
  const mediaSubfolders: string[] = [];
  for (let i = 0; i < subfolders.length; i += 1) {
    const name = subfolders[i];
    const fullPath = `${normalized}${separator}${name}`;
    // eslint-disable-next-line no-await-in-loop
    if (await subfolderContainsMedia(fullPath, mediaType)) {
      mediaSubfolders.push(name);
    }
  }
  if (mediaSubfolders.length >= 2) {
    return mediaSubfolders.map((name) => ({
      name,
      sourcePath: `${normalized}${separator}${name}`,
    }));
  }
  if (mediaType === 'video' && mediaSubfolders.length === 0) {
    const children = await fs.readdir(parentPath, { withFileTypes: true });
    const videoPaths: string[] = [];
    children.forEach((entry) => {
      if (!entry.isFile()) {
        return;
      }
      const fullPath = npath.join(parentPath, entry.name);
      if (isVideoFilePath(fullPath)) {
        videoPaths.push(fullPath);
      }
    });
    videoPaths.sort((a, b) => a.localeCompare(b));
    return videoPaths.map((fullPath) => ({
      name: npath.parse(fullPath).name,
      sourcePath: fullPath,
    }));
  }
  return mediaSubfolders.map((name) => ({
    name,
    sourcePath: `${normalized}${separator}${name}`,
  }));
}

/**
 * Resolve the import path for one camera subfolder (directory or first video file).
 */
async function resolveMulticamCameraSourcePath(
  subfolderPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<string> {
  if (mediaType === 'image-sequence') {
    return subfolderPath;
  }
  const stat = await fs.stat(subfolderPath);
  if (!stat.isDirectory()) {
    return subfolderPath;
  }
  const entries = await fs.readdir(subfolderPath, { withFileTypes: true });
  const videoPaths: string[] = [];
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) {
      return;
    }
    const fullPath = npath.join(subfolderPath, entry.name);
    const mimetype = mime.lookup(fullPath);
    if (mimetype && (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype))) {
      videoPaths.push(fullPath);
    }
  }));
  videoPaths.sort((a, b) => a.localeCompare(b));
  if (!videoPaths.length) {
    throw new Error(`No video file found in ${subfolderPath}`);
  }
  return videoPaths[0];
}

/**
 * Attempt a media import on the provided path, which may or may not be a valid dataset.
 */
async function attemptMediaImport(path: string) {
  try {
    // Must await here, as otherwise the try/catch isn't correctly executed.
    return await beginMediaImport(path);
  } catch (e) {
    console.warn(
      `*** Failed to import at path "${path}", with message: "${(e as Error).message}".`
      + ' This is expected if this file or directory does not contain a dataset.',
    );
  }

  return undefined;
}

/**
 * Recursively import all datasets in this directory, using a "breadth-first" approach.
 * This function only recurses into a directory if the import of that directory fails.
 */
async function bulkMediaImport(path: string): Promise<DesktopMediaImportResponse[]> {
  const children = await fs.readdir(path, { withFileTypes: true });
  const results: {path: fs.Dirent, result: DesktopMediaImportResponse | undefined}[] = [];

  // Use a for-of loop, to run imports sequentially. If run concurrently, they can fail behind the scenes.
  // eslint-disable-next-line no-restricted-syntax
  for (const dirent of children) {
    // eslint-disable-next-line no-await-in-loop
    const result = await attemptMediaImport(npath.resolve(path, dirent.name));
    results.push({
      path: dirent,
      result,
    });
  }

  // Filter successful imports
  const importResults = results.filter((r) => r.result !== undefined).map((r) => r.result as DesktopMediaImportResponse);

  // If the result was undefined and was a directory, recurse.
  const toRecurse = results.filter((r) => r.result === undefined && r.path.isDirectory());

  // Use a for-of loop, to run imports sequentially. If run concurrently, they can fail behind the scenes.
  // eslint-disable-next-line no-restricted-syntax
  for (const r of toRecurse) {
    // eslint-disable-next-line no-await-in-loop
    const results = await bulkMediaImport(npath.resolve(path, r.path.name));
    importResults.push(...results);
  }

  return importResults;
}

/**
 * Begin a dataset import.
 */
async function beginMediaImport(path: string): Promise<DesktopMediaImportResponse> {
  let datasetType: DatasetType;
  const fileExtension = npath.extname(path).replace(/^\./, '').toLowerCase();
  const isDesktopLargeImage = largeImageDesktopTypes.includes(fileExtension);

  const exists = fs.existsSync(path);
  if (!exists) {
    throw new Error(`file or directory not found: ${path}`);
  }

  const stat = await fs.stat(path);
  if (stat.isDirectory()) {
    datasetType = 'image-sequence';
  } else if (stat.isFile()) {
    const mimetype = mime.lookup(path);
    if (mimetype && mimetype === 'text/plain') {
      datasetType = 'image-sequence';
    } else if (isDesktopLargeImage) {
      datasetType = 'large-image';
    } else {
      datasetType = 'video';
    }
  } else {
    throw new Error('Only regular files and directories are supported');
  }

  const dsName = npath.parse(path).name;

  const _defaultFps = datasetType === 'video' ? 5 : 1;
  const jsonConfig: JsonConfig = {
    version: JsonConfigCurrentVersion,
    type: datasetType,
    id: '', // will be assigned on finalize
    fps: _defaultFps, // adjusted below
    originalFps: _defaultFps, // adjusted below
    originalBasePath: npath.normalize(path),
    originalVideoFile: '',
    createdAt: (new Date()).toString(),
    originalImageFiles: [],
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: dsName,
    multiCam: null,
    subType: null,
    confidenceFilters: { default: DefaultConfidence },
  };

  /* TODO: Look for an EXISTING portable config.json to override the above */

  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    jsonConfig.originalBasePath = npath.dirname(path);
  }
  if (datasetType === 'large-image') {
    jsonConfig.originalBasePath = npath.dirname(path);
    jsonConfig.originalLargeImageFile = npath.basename(path);
  }

  /* Path to search for other related data like annotations */
  let relatedDataSearchPath = jsonConfig.originalBasePath;

  /* mediaConvertList is a list of absolute paths of media to convert */
  let mediaConvertList: string[] = [];
  /* Extract and validate media from import path */
  if (jsonConfig.type === 'large-image') {
    // No conversion for large images; tile serving is done on demand via geotiff
  } else if (jsonConfig.type === 'video') {
    jsonConfig.originalVideoFile = npath.basename(path);
    const mimetype = mime.lookup(path);
    if (mimetype) {
      if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
        throw new Error('User chose image file for video import option');
      } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
        const checkMediaResult = await checkMedia(path);
        if (!checkMediaResult.websafe || otherVideoTypes.includes(mimetype)) {
          mediaConvertList.push(path);
        }
        const newAnnotationFps = (
          // Prevent FPS smaller than 1
          Math.max(1, Math.min(jsonConfig.fps, checkMediaResult.originalFps))
        );
        jsonConfig.originalFps = checkMediaResult.originalFps;
        jsonConfig.fps = newAnnotationFps;
      } else {
        throw new Error(`unsupported MIME type for video ${mimetype}`);
      }
    } else {
      throw new Error(`could not determine video MIME type for ${path}`);
    }
  } else if (datasetType === 'image-sequence') {
    const found = await findImagesInFolder(path);
    if (found.imagePaths.length === 0) {
      throw new Error(`no images found in ${path}`);
    }
    if (found.source === 'directory') {
      jsonConfig.originalImageFiles = found.imageNames;
    } else if (found.source === 'image-list') {
      jsonConfig.originalImageFiles = found.imagePaths;
      jsonConfig.imageListPath = npath.normalize(path);
      jsonConfig.originalBasePath = '';
      jsonConfig.name = npath.basename(npath.dirname(path));
      relatedDataSearchPath = npath.dirname(path);
    }
    mediaConvertList = found.mediaConvertList;
  } else if (datasetType !== 'large-image') {
    throw new Error('only video, image-sequence, and large-image types are supported');
  }

  const { trackFileAbsPath, configFileAbsPath } = await
  findTrackandMetaFileinFolder(relatedDataSearchPath);
  // The discovered attachment is a suggestion the import dialog shows and the user can clear or
  // replace, so it travels on the response rather than on jsonConfig.
  const metadata = await suggestMetadataAttachment(relatedDataSearchPath);
  return {
    jsonConfig,
    globPattern: '',
    mediaConvertList,
    trackFileAbsPath,
    forceMediaTranscode: false,
    multiCamTrackFiles: null,
    configFileAbsPath,
    ...(metadata.path ? { metadataFileAbsPath: metadata.path } : {}),
    ...(metadata.warning ? { importWarnings: [metadata.warning] } : {}),
  };
}

function validImageNamesMap(jsonConfig: JsonConfig) {
  if (jsonConfig.originalImageFiles.length > 0) {
    const imageMap = new Map<string, number>();
    jsonConfig.originalImageFiles.forEach((imgPath, i) => {
      const [imageBaseName] = splitExt(imgPath);
      if (imageMap.get(imageBaseName) !== undefined) {
        throw new Error([
          `An image named ${imageBaseName} was found twice in the dataset,`,
          'probably in different folders. DIVE cannot handle this case.',
          'Please contact support.',
        ].join(' '));
      }
      imageMap.set(imageBaseName, i);
    });
    return imageMap;
  }
  return undefined;
}

async function dataFileImport(settings: Settings, id: string, path: string, additive = false, additivePrepend = '') {
  const projectDirData = await getValidatedProjectDir(settings, id);
  const jsonConfig = await loadJsonConfig(projectDirData.datasetFileAbsPath);
  const existingDatasetInfo = jsonConfig.datasetInfo;
  const result = await ingestDataFiles(
    settings,
    id,
    [path],
    undefined,
    validImageNamesMap(jsonConfig),
    additive,
    additivePrepend,
  );
  const { parentId, cameraName } = parseCompositeDatasetId(id);
  const cameraMeta = { ...result.meta };
  if (cameraName) {
    delete cameraMeta.typeHierarchy;
    delete jsonConfig.typeHierarchy;
  }
  mergeImportedConfig(jsonConfig, cameraMeta);
  // Assign datasetInfo explicitly; the deep-merge above would keep keys an Overwrite
  // import meant to drop. Like the server, Overwrite replaces the block wholesale while
  // an additive import merges per-key (imported values win).
  if (result.meta.datasetInfo) {
    jsonConfig.datasetInfo = additive
      ? { ...(existingDatasetInfo ?? {}), ...result.meta.datasetInfo }
      : result.meta.datasetInfo;
  }
  await saveProjectConfig(projectDirData.basePath, jsonConfig);
  // Shared mutable config (styling, thresholds, attributes, datasetInfo, ...) is
  // loaded by the viewer from the base dataset's metadata, so an import
  // targeted at one camera of a multicam dataset must update the base too.
  // Do not sync per-camera imageEnhancements or camera-registration fields.
  const hierarchyPresent = Object.prototype.hasOwnProperty.call(result.meta, 'typeHierarchy');
  if (cameraName && (
    hierarchyPresent || MulticamSharedMutableKeys.some((key) => key in result.meta)
  )) {
    const baseProjectDir = getProjectDir(settings, parentId);
    if (await fs.pathExists(baseProjectDir.datasetFileAbsPath)) {
      const baseMeta = await loadJsonConfig(baseProjectDir.datasetFileAbsPath);
      const existingBaseDatasetInfo = baseMeta.datasetInfo;
      const parentMeta = pick(result.meta, MulticamSharedMutableKeys);
      if (hierarchyPresent) {
        parentMeta.typeHierarchy = result.meta.typeHierarchy;
      }
      mergeImportedConfig(baseMeta, parentMeta);
      if (result.meta.datasetInfo) {
        baseMeta.datasetInfo = additive
          ? { ...(existingBaseDatasetInfo ?? {}), ...result.meta.datasetInfo }
          : result.meta.datasetInfo;
      }
      await saveProjectConfig(baseProjectDir.basePath, baseMeta);
    }
  }
  return result;
}

function mergeCameraTypeHierarchy(
  promoted: Record<string, string> | undefined,
  cameraHierarchy: Record<string, string>,
  cameraName: string,
): { hierarchy: Record<string, string>; warning?: string } {
  try {
    const write = resolveTypeHierarchy(promoted ?? null, true, cameraHierarchy, 'additive');
    return {
      hierarchy: write.action === 'set' ? { ...write.hierarchy } : { ...(promoted || {}) },
    };
  } catch (error) {
    if (!(error instanceof TypeHierarchyError)) {
      throw error;
    }
    return {
      hierarchy: { ...(promoted || {}) },
      warning: `Camera "${cameraName}" type hierarchy was skipped: ${error.reason}`,
    };
  }
}

async function _importTrackFile(
  settings: Settings,
  dsId: string,
  projectDirAbsPath: string,
  jsonConfig: JsonConfig,
  userTrackFileAbsPath: string,
  promoteTypeHierarchy = false,
) {
  /* custom image sort */
  if (jsonConfig.imageListPath === undefined) {
    jsonConfig.originalImageFiles.sort(strNumericCompare);
  }
  if (jsonConfig.transcodedImageFiles) {
    jsonConfig.transcodedImageFiles.sort(strNumericCompare);
  }
  let promotedTypeHierarchy: Record<string, string> | undefined;
  let warnings: string[] = [];
  if (userTrackFileAbsPath) {
    const processed = await ingestDataFiles(settings, dsId, [userTrackFileAbsPath], undefined, validImageNamesMap(jsonConfig));
    const importedMeta = { ...processed.meta };
    if (promoteTypeHierarchy && importedMeta.typeHierarchy) {
      promotedTypeHierarchy = importedMeta.typeHierarchy;
      delete importedMeta.typeHierarchy;
    }
    merge(jsonConfig, importedMeta);
    warnings = processed.warnings;
    if (processed.processedFiles.length === 0) {
      await _saveSerialized(settings, dsId, dive.makeEmptyAnnotationFile(), true);
    }
  } else {
    await _saveSerialized(settings, dsId, dive.makeEmptyAnnotationFile(), true);
  }
  await saveProjectConfig(projectDirAbsPath, jsonConfig);
  return { jsonConfig, typeHierarchy: promotedTypeHierarchy, warnings };
}

/**
 * After media conversion we need to remove the transcodingKey to signify it is done
 */
export async function completeConversion(settings: Settings, datasetId: string, transcodingJobKey: string, meta: JsonConfig) {
  await getValidatedProjectDir(settings, datasetId);
  if (meta.transcodingJobKey === transcodingJobKey) {
    // eslint-disable-next-line no-param-reassign
    meta.transcodingJobKey = undefined;
    saveConfig(settings, datasetId, meta);
  }
}

export async function failConversion(settings: Settings, datasetId: string, meta: JsonConfig, errorMessage: string) {
  await getValidatedProjectDir(settings, datasetId);
  // eslint-disable-next-line no-param-reassign
  meta.error = errorMessage;
  saveConfig(settings, datasetId, meta);
}

/**
 * Finalize a dataset import.
 */
async function finalizeMediaImport(
  settings: Settings,
  args: DesktopMediaImportResponse,
): Promise<ConversionArgs> {
  const { jsonConfig, globPattern } = args;
  let { mediaConvertList } = args;
  const { type: datasetType } = jsonConfig;
  jsonConfig.id = `${cleanString(jsonConfig.name).substr(0, 20)}_${makeid(10)}`;
  const projectDirAbsPath = await _initializeProjectDir(settings, jsonConfig);

  // Store any stereo calibration / camera file alongside the media and normalize
  // it to the VIAME JSON camera-rig format (keeping the original).
  if (jsonConfig.multiCam?.calibration) {
    const calibrationSourcePath = npath.resolve(jsonConfig.multiCam.calibration);
    const preservedOriginalPath = npath.join(
      projectDirAbsPath,
      npath.basename(calibrationSourcePath),
    );
    jsonConfig.multiCam.calibrationOriginalName = realCalibrationName(calibrationSourcePath);
    jsonConfig.multiCam.calibration = await prepareDatasetCalibration(
      settings,
      projectDirAbsPath,
      calibrationSourcePath,
    );
    jsonConfig.multiCam.calibrationSourcePath = preservedOriginalPath;
  }

  // Store any optional metadata file alongside the media (keeping the original
  // name). beginMediaImport / beginMultiCamImport put the source path on
  // metadataFileAbsPath so ImportDialog can show and clear it; jsonConfig.metadataFile
  // remains a fallback for older callers that still stash the source there.
  const metadataSourcePath = args.metadataFileAbsPath || jsonConfig.metadataFile;
  if (metadataSourcePath) {
    const resolvedMetadataSource = npath.resolve(metadataSourcePath);
    const metadataOriginalName = npath.basename(resolvedMetadataSource);
    if (!metadataFileTypes.includes(npath.extname(metadataOriginalName).slice(1).toLowerCase())) {
      throw new Error('Metadata attachment must be a JSON, TXT, or CSV file');
    }
    const metadataDir = npath.join(projectDirAbsPath, AuxFolderName);
    await fs.ensureDir(metadataDir);
    const metadataDest = npath.join(
      metadataDir,
      metadataOriginalName,
    );
    if (resolvedMetadataSource !== metadataDest) {
      await fs.copy(resolvedMetadataSource, metadataDest);
    }
    jsonConfig.metadataOriginalName = metadataOriginalName;
    jsonConfig.metadataFile = metadataDest;
  } else {
    // Ensure a stale source path never survives when no file was chosen.
    jsonConfig.metadataFile = undefined;
    jsonConfig.metadataOriginalName = undefined;
  }

  if (datasetType === MultiType && jsonConfig.multiCam?.cameras) {
    const cameraEntries = Object.entries(jsonConfig.multiCam.cameras);
    for (let i = 0; i < cameraEntries.length; i += 1) {
      const [cameraName, camera] = cameraEntries[i];
      if (camera.metadataFile) {
        const source = npath.resolve(camera.metadataFile);
        const originalName = npath.basename(camera.metadataOriginalName || source);
        const cameraMetadataDir = npath.join(projectDirAbsPath, AuxFolderName, cameraName);
        // eslint-disable-next-line no-await-in-loop
        await fs.ensureDir(cameraMetadataDir);
        const destination = npath.join(cameraMetadataDir, originalName);
        if (source !== destination) {
          // eslint-disable-next-line no-await-in-loop
          await fs.copy(source, destination);
        }
        camera.metadataFile = destination;
        camera.metadataOriginalName = originalName;
      }
    }
  }

  // Filter all parts of the input based on glob pattern
  if (globPattern && jsonConfig.type === 'image-sequence') {
    const searchPath = jsonConfig.imageListPath || jsonConfig.originalBasePath;
    const found = await findImagesInFolder(searchPath, globPattern);
    if (found.imageNames.length === 0) {
      throw new Error(`no images in ${searchPath} matched pattern ${globPattern}`);
    }
    if (found.source === 'directory') {
      jsonConfig.originalImageFiles = found.imageNames;
    } else if (found.source === 'image-list') {
      jsonConfig.originalImageFiles = found.imagePaths;
    }
    mediaConvertList = found.mediaConvertList;
  }

  if (jsonConfig.type === 'video') {
    // Verify that the user didn't choose an FPS value higher than originalFPS
    // This shouldn't be possible in the UI, but we should still prevent it here.
    jsonConfig.fps = (
      Math.max(1, Math.min(jsonConfig.fps, jsonConfig.originalFps))
    );
    if (args.forceMediaTranscode) {
      mediaConvertList.push(npath.join(jsonConfig.originalBasePath, jsonConfig.originalVideoFile));
    }
  }

  // Determine which files, if any, need to be queued for conversion. Consumers
  // of this function are responsible for starting the conversion.
  const srcDstList: [string, string][] = [];
  if (mediaConvertList.length) {
    const extension = datasetType === 'video' ? '.mp4' : '.png';
    let destAbsPath = '';
    mediaConvertList.forEach((absPath) => {
      const filename = npath.basename(absPath);
      const destLoc = npath.join(projectDirAbsPath, filename);
      //If we have multicam we may need to check more than the base folder
      if (datasetType === MultiType) {
        destAbsPath = transcodeMultiCam(jsonConfig, absPath, projectDirAbsPath);
      } else {
        destAbsPath = destLoc.replace(npath.extname(absPath), extension);
        if (datasetType === 'video') {
          jsonConfig.transcodedVideoFile = npath.basename(destAbsPath);
        } else if (datasetType === 'image-sequence') {
          if (!jsonConfig.transcodedImageFiles) {
            jsonConfig.transcodedImageFiles = [];
          }
          jsonConfig.transcodedImageFiles.push(npath.basename(destAbsPath));
        }
      }
      srcDstList.push([absPath, destAbsPath]);
    });
  }

  //We need to create datasets for each of the multiCam folders as well
  let promotedTypeHierarchy = jsonConfig.typeHierarchy
    ? { ...jsonConfig.typeHierarchy }
    : undefined;
  const importWarnings: string[] = [];
  if (datasetType === MultiType && jsonConfig.multiCam?.cameras) {
    const { cameras } = jsonConfig.multiCam;
    const orderedCameraNames = orderedMultiCamCameraNames(jsonConfig.multiCam);
    const cameraNames = [
      ...orderedCameraNames,
      ...Object.keys(cameras).filter((name) => !orderedCameraNames.includes(name)),
    ];
    const cameraNameAndData = cameraNames.map(
      (cameraName) => [cameraName, cameras[cameraName]] as const,
    );
    for (let i = 0; i < cameraNameAndData.length; i += 1) {
      const [cameraName, cameraData] = cameraNameAndData[i];

      const jsonClone = { ...cloneDeep(jsonConfig), ...cameraData };
      if (!cameraData.metadataFile) {
        delete jsonClone.metadataFile;
        delete jsonClone.metadataOriginalName;
      }
      jsonClone.multiCam = null;
      jsonClone.id = `${jsonConfig.id}/${cameraName}`;
      jsonClone.transcodedVideoFile = cameraData.transcodedVideoFile || '';
      jsonClone.transcodedImageFiles = cameraData.transcodedImageFiles || [];
      jsonClone.subType = null;
      delete jsonClone.typeHierarchy;
      // eslint-disable-next-line no-await-in-loop
      const cameraDirAbsPath = await _initializeProjectDir(settings, jsonClone);
      let multiCamTrackFile = '';
      if (args.multiCamTrackFiles && args.multiCamTrackFiles[cameraName]) {
        multiCamTrackFile = args.multiCamTrackFiles[cameraName];
      }
      // eslint-disable-next-line no-await-in-loop
      const imported = await _importTrackFile(
        settings,
        jsonClone.id,
        cameraDirAbsPath,
        jsonClone,
        multiCamTrackFile,
        true,
      );
      importWarnings.push(...imported.warnings);
      if (imported.typeHierarchy) {
        const merged = mergeCameraTypeHierarchy(
          promotedTypeHierarchy,
          imported.typeHierarchy,
          cameraName,
        );
        promotedTypeHierarchy = merged.hierarchy;
        if (merged.warning) {
          importWarnings.push(merged.warning);
        }
      }
    }
  }
  if (promotedTypeHierarchy && Object.keys(promotedTypeHierarchy).length > 0) {
    jsonConfig.typeHierarchy = promotedTypeHierarchy;
  }
  const finalImport = await _importTrackFile(
    settings,
    jsonConfig.id,
    projectDirAbsPath,
    jsonConfig,
    args.trackFileAbsPath,
  );
  const finalJsonConfig = finalImport.jsonConfig;
  importWarnings.push(...finalImport.warnings);
  if (args.configFileAbsPath) {
    await dataFileImport(settings, jsonConfig.id, args.configFileAbsPath);
  }
  const conversionJobArgs: ConversionArgs = {
    type: JobType.Conversion,
    meta: finalJsonConfig,
    mediaList: srcDstList,
    importWarnings,
  };
  return conversionJobArgs;
}

/**
 * Get the absolute path to the large image (e.g. GeoTIFF) file for a dataset.
 * Returns null if the dataset is not type 'large-image' or path is missing.
 */
async function getLargeImagePath(settings: Settings, datasetId: string): Promise<string | null> {
  try {
    const projectDirData = await getValidatedProjectDir(settings, datasetId);
    const meta = await loadJsonConfig(projectDirData.datasetFileAbsPath);
    if (meta.type !== 'large-image' || !meta.originalLargeImageFile) {
      console.warn(
        `[tiles] getLargeImagePath: no path for dataset "${datasetId}" (meta.type=${meta.type}, hasOriginalLargeImageFile=${!!meta.originalLargeImageFile})`,
      );
      return null;
    }
    const path = npath.join(meta.originalBasePath, meta.originalLargeImageFile);
    return path;
  } catch (err) {
    console.warn(`[tiles] getLargeImagePath: error for dataset "${datasetId}":`, err);
    return null;
  }
}

/**
 * Resolve the absolute path of the ORIGINAL (pre-transcode) image for a frame.
 *
 * The percentile-stretch / display path must read the original source image
 * (e.g. a 16-bit IR TIFF), NOT the 8-bit PNG produced by import-time transcoding
 * (`transcodedImageFiles`), which has already discarded the dynamic range the
 * stretch is meant to recover. `imageData` URLs sent to the client point at the
 * transcoded copies, so the client passes a frame index and we map it back to
 * the original here. Returns null if the frame is out of range or unavailable.
 */
async function getDisplayImagePath(
  settings: Settings,
  datasetId: string,
  frame: number,
): Promise<string | null> {
  try {
    const projectDirData = await getValidatedProjectDir(settings, datasetId);
    const meta = await loadJsonConfig(projectDirData.datasetFileAbsPath);
    const originals = meta.originalImageFiles ?? [];
    if (!Number.isInteger(frame) || frame < 0 || frame >= originals.length) {
      console.warn(
        `[display] getDisplayImagePath: frame ${frame} out of range for dataset "${datasetId}" (${originals.length} images)`,
      );
      return null;
    }
    const entry = originals[frame];
    // originalImageFiles entries are relative to originalBasePath, except for
    // image-list imports where they are absolute and originalBasePath is ''.
    return npath.isAbsolute(entry) ? entry : npath.join(meta.originalBasePath, entry);
  } catch (err) {
    console.warn(`[display] getDisplayImagePath: error for dataset "${datasetId}":`, err);
    return null;
  }
}

async function openLink(url: string) {
  shell.openExternal(url);
}

/**
 * Open a file or folder in the system file manager.
 * Returns an empty string on success or an error message on failure.
 *
 * shell.openPath can hang indefinitely on Linux (never resolving its promise),
 * which breaks ipcMain.handle callers. Files use showItemInFolder; directories
 * use a detached platform opener so the IPC handler always replies promptly.
 */
async function openPathInFileManager(targetPath: string): Promise<string> {
  if (!targetPath?.trim()) {
    return 'No path specified';
  }
  const resolved = npath.resolve(targetPath.trim());
  if (!(await fs.pathExists(resolved))) {
    return `Path does not exist: ${resolved}`;
  }

  const stat = await fs.stat(resolved);
  if (stat.isFile()) {
    shell.showItemInFolder(resolved);
    return '';
  }

  if (process.platform === 'linux') {
    spawn('xdg-open', [resolved], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }
  if (process.platform === 'win32') {
    spawn('explorer', [resolved], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }
  if (process.platform === 'darwin') {
    spawn('open', [resolved], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }

  return shell.openPath(resolved);
}

async function exportDataset(settings: Settings, args: ExportDatasetArgs) {
  const projectDirInfo = await getValidatedProjectDir(settings, args.id);
  const meta = await loadJsonConfig(projectDirInfo.datasetFileAbsPath);
  const data = await loadAnnotationFile(projectDirInfo.trackFileAbsPath);
  const { cameraName } = parseCompositeDatasetId(args.id);
  if (cameraName) {
    const hierarchy = await loadCanonicalHierarchy(settings, args.id);
    if (hierarchy === null) {
      delete meta.typeHierarchy;
    } else {
      meta.typeHierarchy = hierarchy as Record<string, string>;
    }
  }
  if (args.type === 'json') {
    return dive.serializeFile(args.path, data, meta, args.typeFilter, {
      excludeBelowThreshold: args.exclude,
      header: true,
    });
  }
  if (args.type === 'coco') {
    const hierarchy = normalizedHierarchyForExport(meta, 'COCO file');
    if (hierarchy) {
      meta.typeHierarchy = { ...hierarchy };
    } else {
      delete meta.typeHierarchy;
    }
    return coco.serializeFile(args.path, data, meta, args.typeFilter, {
      excludeBelowThreshold: args.exclude,
    });
  }
  return viameSerializers.serializeFile(args.path, data, meta, args.typeFilter, {
    excludeBelowThreshold: args.exclude,
    header: true,
  });
}

async function exportConfiguration(settings: Settings, args: ExportConfigurationArgs) {
  const projectDirInfo = await getValidatedProjectDir(settings, args.id);
  const meta = await loadJsonConfig(projectDirInfo.datasetFileAbsPath);
  const { cameraName } = parseCompositeDatasetId(args.id);
  if (cameraName) {
    const hierarchy = await loadCanonicalHierarchy(settings, args.id);
    if (hierarchy === null) {
      delete meta.typeHierarchy;
    } else {
      meta.typeHierarchy = hierarchy as Record<string, string>;
    }
  }
  const output: DatasetConfigMutable & { version: number} = { version: meta.version };
  const hierarchy = normalizedHierarchyForExport(meta);
  if (DatasetConfigMutableKeys.some((key) => key in meta)) {
    // DIVE Configuration File fields (attributes, styles, FPS, …)
    merge(output, pick(meta, DatasetConfigMutableKeys));
  }
  if (hierarchy) {
    output.typeHierarchy = { ...hierarchy };
  } else {
    delete output.typeHierarchy;
  }
  await fs.writeJSON(args.path, output);
  return args.path;
}

export {
  ProjectsFolderName,
  JobsFolderName,
  ArchiveMetadataFolderName,
  autodiscoverData,
  bulkMediaImport,
  beginMediaImport,
  dataFileImport,
  deleteDataset,
  checkDataset,
  exportConfiguration,
  exportDataset,
  finalizeMediaImport,
  getPipelineList,
  deleteTrainedPipeline,
  getTrainingConfigs,
  getProjectDir,
  getValidatedProjectDir,
  getLargeImagePath,
  getDisplayImagePath,
  loadConfig,
  loadJsonConfig,
  loadAnnotationFile,
  loadDetections,
  loadFrameMetadata,
  frameMetadataSourceDirectories,
  discoverMetadataAttachment,
  openLink,
  openPathInFileManager,
  ingestDataFiles,
  saveDetections,
  saveConfig,
  saveProjectConfig,
  processTrainedPipeline,
  findResumableTrainingJobs,
  discardResumableTraining,
  saveAttributes,
  saveAttributeTrackFilters,
  findImagesInFolder,
  isVideoFilePath,
  listImmediateSubfolders,
  listParentFolderCameras,
  resolveMulticamCameraSourcePath,
};

export {
  fromRegistrationPairs,
  findParentFolderTransformFiles,
  exportCameraRegistration,
  importCameraRegistration,
} from './cameraRegistration';

export {
  findParentFolderCalibrationFile,
  getLastCalibrationPath,
  saveLastCalibration,
  applyCalibrationToUncalibratedStereoDatasets,
  applyCalibrationToDataset,
  datasetHasCalibrationFile,
  getDatasetCalibrationPath,
  getDatasetCalibrationExportPath,
  setDatasetCalibration,
  exportDatasetCalibration,
  getDatasetCalibration,
  deleteDatasetCalibration,
} from './datasetCalibration';

export { exportMulticamEverything } from './multicamExport';

export {
  loadGlobalStyleSettings,
  saveGlobalStyleSettings,
} from './globalStyles';
