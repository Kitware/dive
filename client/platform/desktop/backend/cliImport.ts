/**
 * Command-line launch support for DIVE Desktop.
 *
 * Allows the app to be started directly on a dataset, skipping the import
 * wizard.
 *
 * Single camera:
 *
 *   dive-desktop --import <media> [--annotations <file>] [--name <name>]
 *
 * Multi-camera and stereo, by naming each camera:
 *
 *   dive-desktop --camera left=<media> --camera right=<media> \
 *                --annotations left=<file> --annotations right=<file> \
 *                --calibration <file>
 *
 * <media> is anything the import wizard accepts: an image-sequence directory,
 * an image-list text file, or a video. Annotation files are VIAME CSV or DIVE
 * JSON. A dataset whose cameras are named exactly `left` and `right` is typed
 * as stereo by the importer; any other set of names is multicam.
 *
 * This drives the same backend calls as the import wizard, so a CLI-launched
 * dataset is indistinguishable from a hand-imported one.
 */
import npath from 'path';
import mime from 'mime-types';

import { MultiCamImportFolderArgs } from 'dive-common/apispec';
import { otherVideoTypes, websafeVideoTypes } from 'dive-common/constants';
import {
  CliTranscodingNotice,
  ConversionArgs,
  DesktopJob,
  DesktopJobUpdate,
  DesktopMediaImportResponse,
} from 'platform/desktop/constants';

export type { CliTranscodingNotice };
import { convertMedia } from './native/mediaJobs';
import beginMultiCamImport from './native/multiCamImport';
import * as common from './native/common';
import settings from './state/settings';

export interface CliOpenArgs {
  /** Media to import: image directory, image-list text file, or video. */
  importPath?: string;
  /**
   * Annotations to load. A bare path for a single-camera dataset; keyed by
   * camera name for a multi-camera one.
   */
  annotationPath?: string;
  cameraAnnotations?: Record<string, string>;
  /** Media per camera name. Presence of this selects the multi-camera import. */
  cameras?: Record<string, string>;
  /** Camera names in the order given, which is the display order. */
  cameraOrder?: string[];
  /** Camera shown by default; defaults to `left`, else the first camera. */
  defaultDisplay?: string;
  /** Stereo calibration file (.npz or .json). */
  calibrationPath?: string;
  /** Optional dataset display name; defaults to the media basename. */
  name?: string;
}

/** A camera media path is a video if its mimetype says so, else an image sequence. */
function inferDatasetType(mediaPath: string): 'video' | 'image-sequence' {
  const mimetype = mime.lookup(mediaPath);
  if (mimetype && (websafeVideoTypes.includes(mimetype)
    || otherVideoTypes.includes(mimetype))) {
    return 'video';
  }
  return 'image-sequence';
}

/**
 * Split a `name=value` flag argument. Only the first `=` separates, so Windows
 * paths (`left=C:\data\left`) survive intact.
 */
function splitNamed(arg: string, flag: string): [string, string] {
  const idx = arg.indexOf('=');
  if (idx <= 0 || idx === arg.length - 1) {
    throw new Error(`${flag} expects <camera>=<path>, got: ${arg}`);
  }
  return [arg.slice(0, idx), arg.slice(idx + 1)];
}

/**
 * Pull the launch arguments out of an argv.
 *
 * Electron hands us its own switches (--no-sandbox, --inspect, the dev entry
 * path, ...) alongside ours, so scan for known flags rather than assuming
 * positions. Returns null when neither --import nor --camera was supplied,
 * which is the ordinary "just open the app" case.
 */
export function parseCliArgs(argv: string[]): CliOpenArgs | null {
  /** Every value given for a flag, so repeatable flags collect. */
  const readFlagAll = (...names: string[]): string[] => {
    const values: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      const match = names.find((name) => arg === name || arg.startsWith(`${name}=`));
      if (match) {
        if (arg.startsWith(`${match}=`)) {
          const value = arg.slice(match.length + 1);
          if (value) values.push(value);
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          values.push(argv[i + 1]);
        }
      }
    }
    return values;
  };
  const readFlag = (...names: string[]): string | undefined => readFlagAll(...names)[0];

  const importPath = readFlag('--import', '-i');
  const cameraArgs = readFlagAll('--camera', '-c');
  if (!importPath && !cameraArgs.length) {
    return null;
  }
  if (importPath && cameraArgs.length) {
    throw new Error('--import and --camera are mutually exclusive: --import is a '
      + 'single-camera dataset, --camera builds a multi-camera one');
  }

  const annotationArgs = readFlagAll('--annotations', '--annotation', '-a');
  const calibration = readFlag('--calibration');
  const name = readFlag('--name', '-n');

  if (!cameraArgs.length) {
    // Single camera. A camera-keyed annotation here is a mistake worth naming,
    // since it would otherwise be silently resolved as a relative file path.
    if (annotationArgs.length > 1) {
      throw new Error('--annotations may only be given once for a single-camera '
        + 'dataset; use --camera to import multiple cameras');
    }
    if (calibration) {
      throw new Error('--calibration applies to multi-camera datasets; '
        + 'pass cameras with --camera');
    }
    return {
      importPath: npath.resolve(importPath as string),
      annotationPath: annotationArgs[0] ? npath.resolve(annotationArgs[0]) : undefined,
      name,
    };
  }

  // Multi-camera. Order of the flags is the display order.
  const cameras: Record<string, string> = {};
  const cameraOrder: string[] = [];
  cameraArgs.forEach((arg) => {
    const [cameraName, mediaPath] = splitNamed(arg, '--camera');
    if (cameras[cameraName]) {
      throw new Error(`--camera ${cameraName} given more than once`);
    }
    cameras[cameraName] = npath.resolve(mediaPath);
    cameraOrder.push(cameraName);
  });
  if (cameraOrder.length < 2) {
    throw new Error('a multi-camera dataset needs at least two --camera arguments');
  }

  const cameraAnnotations: Record<string, string> = {};
  annotationArgs.forEach((arg) => {
    const [cameraName, annotationFile] = splitNamed(arg, '--annotations');
    if (!cameras[cameraName]) {
      throw new Error(`--annotations names an unknown camera '${cameraName}'; `
        + `known cameras: ${cameraOrder.join(', ')}`);
    }
    cameraAnnotations[cameraName] = npath.resolve(annotationFile);
  });

  const defaultDisplay = readFlag('--default-display') ?? (
    cameras.left ? 'left' : cameraOrder[0]
  );
  if (!cameras[defaultDisplay]) {
    throw new Error(`--default-display names an unknown camera '${defaultDisplay}'; `
      + `known cameras: ${cameraOrder.join(', ')}`);
  }

  return {
    cameras,
    cameraOrder,
    cameraAnnotations,
    defaultDisplay,
    calibrationPath: calibration ? npath.resolve(calibration) : undefined,
    name,
  };
}

/** Build the wizard's multi-camera import args from the parsed CLI arguments. */
function buildMultiCamArgs(args: CliOpenArgs): MultiCamImportFolderArgs {
  const cameras = args.cameras as Record<string, string>;
  const cameraOrder = args.cameraOrder ?? Object.keys(cameras);

  // One dataset type covers every camera, so they must agree: mixing a video
  // with an image sequence would import one of them as the wrong kind.
  const types = new Set(cameraOrder.map((c) => inferDatasetType(cameras[c])));
  if (types.size > 1) {
    throw new Error('every --camera must be the same kind of media: got a mix of '
      + 'video and image sequences');
  }

  const sourceList: MultiCamImportFolderArgs['sourceList'] = {};
  cameraOrder.forEach((cameraName) => {
    sourceList[cameraName] = {
      sourcePath: cameras[cameraName],
      trackFile: args.cameraAnnotations?.[cameraName] ?? '',
    };
  });

  return {
    datasetName: args.name,
    defaultDisplay: args.defaultDisplay as string,
    cameraOrder,
    sourceList,
    calibrationFile: args.calibrationPath,
    type: [...types][0],
  };
}

/**
 * Import the media (and annotations, if given) and return the new dataset id.
 *
 * Media that needs transcoding cannot be viewed until its conversion job
 * finishes, so the id is reported through onReady instead of being returned
 * immediately. onReady fires once the dataset is actually viewable.
 * onTranscoding fires as soon as conversion is known to be required so the UI
 * or console can tell the user why the viewer has not opened yet.
 */
export async function runCliImport(
  args: CliOpenArgs,
  updater: (update: DesktopJobUpdate) => void,
  onReady: (datasetId: string) => void,
  onTranscoding?: (notice: CliTranscodingNotice) => void,
): Promise<string> {
  const currentSettings = settings.get();

  // Multi-camera datasets carry their annotations per camera through the import
  // payload; single-camera ones import theirs onto the dataset after finalize.
  const importPayload: DesktopMediaImportResponse = args.cameras
    ? await beginMultiCamImport(buildMultiCamArgs(args))
    : await common.beginMediaImport(args.importPath as string);
  if (args.name) {
    importPayload.jsonMeta.name = args.name;
  }

  const conversionArgs: ConversionArgs = await common.finalizeMediaImport(currentSettings, importPayload);
  const datasetId = conversionArgs.meta.id;

  if (args.annotationPath) {
    await common.dataFileImport(currentSettings, datasetId, args.annotationPath);
  }

  if (conversionArgs.mediaList.length === 0) {
    onReady(datasetId);
    return datasetId;
  }

  // Transcoding required. Tell the caller before queuing so cold-start and
  // second-instance opens can surface the wait (console + in-app notice).
  onTranscoding?.({
    datasetId,
    name: conversionArgs.meta.name,
    mediaCount: conversionArgs.mediaList.length,
  });

  // Queue the conversion and open the dataset once it lands, mirroring what
  // the import wizard does with the same ConversionArgs.
  const job: DesktopJob = await convertMedia(
    currentSettings,
    conversionArgs,
    updater,
    (jobKey, meta) => {
      common.completeConversion(currentSettings, datasetId, jobKey, meta);
      onReady(datasetId);
    },
    (_jobKey, meta, errorMessage) => common.failConversion(currentSettings, datasetId, meta, errorMessage),
    true,
  );
  updater({
    ...job,
    body: [`Converting media for ${conversionArgs.meta.name}...`],
  });

  return datasetId;
}
