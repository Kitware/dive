/**
 * Command-line launch support for DIVE Desktop.
 *
 * Allows the app to be started directly on a dataset, skipping the import
 * wizard:
 *
 *   dive-desktop --import <media> [--annotations <file>] [--name <name>]
 *
 * <media> is anything beginMediaImport accepts: an image-sequence directory, an
 * image-list text file, or a video. <file> is a VIAME CSV or DIVE JSON.
 *
 * This drives the same backend calls as the import wizard in Recent.vue, so a
 * CLI-launched dataset is indistinguishable from a hand-imported one.
 */
import npath from 'path';

import { ConversionArgs, DesktopJob, DesktopJobUpdate } from 'platform/desktop/constants';
import { convertMedia } from './native/mediaJobs';
import * as common from './native/common';
import settings from './state/settings';

export interface CliOpenArgs {
  /** Media to import: image directory, image-list text file, or video. */
  importPath: string;
  /** Optional VIAME CSV or DIVE JSON annotations to load onto the dataset. */
  annotationPath?: string;
  /** Optional dataset display name; defaults to the media basename. */
  name?: string;
}

/**
 * Pull the launch arguments out of an argv.
 *
 * Electron hands us its own switches (--no-sandbox, --inspect, the dev entry
 * path, ...) alongside ours, so scan for known flags rather than assuming
 * positions. Returns null when no --import was supplied, which is the ordinary
 * "just open the app" case.
 */
export function parseCliArgs(argv: string[]): CliOpenArgs | null {
  const readFlag = (...names: string[]): string | undefined => {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      const match = names.find((name) => arg === name || arg.startsWith(`${name}=`));
      if (match) {
        if (arg.startsWith(`${match}=`)) {
          const value = arg.slice(match.length + 1);
          if (value) return value;
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          return argv[i + 1];
        }
      }
    }
    return undefined;
  };

  const importPath = readFlag('--import', '-i');
  if (!importPath) {
    return null;
  }
  const annotationPath = readFlag('--annotations', '--annotation', '-a');
  return {
    importPath: npath.resolve(importPath),
    annotationPath: annotationPath ? npath.resolve(annotationPath) : undefined,
    name: readFlag('--name', '-n'),
  };
}

/**
 * Import the media (and annotations, if given) and return the new dataset id.
 *
 * Media that needs transcoding cannot be viewed until its conversion job
 * finishes, so the id is reported through onReady instead of being returned
 * immediately. onReady fires once the dataset is actually viewable.
 */
export async function runCliImport(
  args: CliOpenArgs,
  updater: (update: DesktopJobUpdate) => void,
  onReady: (datasetId: string) => void,
): Promise<string> {
  const currentSettings = settings.get();

  const importPayload = await common.beginMediaImport(args.importPath);
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

  // Transcoding required. Queue the conversion and open the dataset once it
  // lands, mirroring what the import wizard does with the same ConversionArgs.
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
