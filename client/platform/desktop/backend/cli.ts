#!/usr/bin/env node
/* eslint-disable @typescript-eslint/ban-ts-comment */
/// <reference types="@types/geojson" />
// @ts-nocheck

/**
 * Command-line entrypoints into serializers and other tooling.
 * See README.md for usage
 */
import OS from 'os';
import npath from 'path';
import { Writable } from 'stream';
import { stdout, stderr } from 'process';
import yargs from 'yargs';
import fs from 'fs-extra';

import Track from 'vue-media-annotator/track';

import { DesktopJobUpdate, RunPipeline, RunTraining } from 'platform/desktop/constants';
import { loadAnnotationFile, loadJsonMetadata } from 'platform/desktop/backend/native/common';
import { RectBounds } from 'vue-media-annotator/utils';
import mime from 'mime-types';

import { otherVideoTypes, websafeVideoTypes } from 'dive-common/constants';
import linux from './native/linux';
import win32 from './native/windows';
import * as common from './native/common';
import { checkMedia, convertMedia } from './native/mediaJobs';
import { parseFrameLabelPresets, applyFrameLabelPresets } from './native/frameLabels';
import { parseFile, serialize } from './serializers/viame';
import { exportNist, loadNistFile } from './serializers/nist';
import KPF from './serializers/kpf';

function getCurrentPlatform() {
  const platform = OS.platform() === 'win32' ? win32 : linux;
  if (OS.platform() === 'win32') {
    win32.initialize();
  }
  return platform;
}

// https://stackoverflow.com/questions/21491567/how-to-implement-a-writable-stream
function echoStream() {
  return new Writable({
    write(chunk, encoding, next) {
      stdout.write(chunk.toString());
      next();
    },
  });
}

function updater(update: DesktopJobUpdate) {
  update.body.forEach((s) => stdout.write(s));
}

async function parseViameFile(file: string) {
  const data = await parseFile(file);
  stdout.write(JSON.stringify(data[0]));
}

async function parseJsonFile(filepath: string, metapath: string) {
  await Promise.all([
    loadAnnotationFile(filepath),
    loadJsonMetadata(metapath),
  ]).then(([input, meta]) => serialize(echoStream(), input, meta));
}

async function parseNistFile(filepath: string, bounds: RectBounds) {
  const data = await loadNistFile(filepath, bounds);
  stdout.write(JSON.stringify(data));
}

async function convertJSONtoNist(filepath: string, meta: string) {
  const metaData = await loadJsonMetadata(meta);
  const data = await loadAnnotationFile(filepath);

  const videoFile = metaData.originalVideoFile;
  if (!videoFile) {
    throw new Error(`No video file exists for metadata ${meta}`);
  }
  const output = await exportNist(data, videoFile);
  stdout.write(JSON.stringify(output));
}

function settingsArgs() {
  yargs.option('datapath', {
    describe: 'path to DIVA data',
  });
  yargs.option('viamepath', {
    describe: 'path to VIAME install',
  });
}

const { argv } = yargs
  .scriptName('divecli')
  .command('viame2json [file]', 'Convert VIAME CSV to JSON', (y) => {
    y.positional('file', {
      description: 'The file to parse',
      type: 'string',
    }).demandOption('file');
  })
  .command('json2viame [file] [meta]', 'Convert JSON to VIAME CSV', () => {
    yargs.positional('file', {
      description: 'The file to parse',
      type: 'string',
    });
    yargs.positional('meta', {
      description: 'The metadata to parse',
      type: 'string',
    });
    yargs.demandOption(['file', 'meta']);
  })
  .command('kpf2json [activityFile] [geometryFile] [typeFile]', 'Convert KPF to JSON', (y) => {
    y.positional('activityFile', {
      description: 'Activity File',
      type: 'string',
    });
    y.positional('geometryFile', {
      description: 'Geometry File',
      type: 'string',
    });
    y.positional('typeFile', {
      description: 'Type File',
      type: 'string',
    });
    yargs.demandOption(['activityFile', 'geometryFile', 'typeFile']);
  })
  .command('nist2json [file] [video]', 'Convert NIST to JSON', () => {
    yargs.positional('file', {
      description: 'NIST JSON file to parse',
      type: 'string',
    });
    yargs.positional('video', {
      description: 'Video file associated with NIST',
      type: 'string',
    });
    yargs.demandOption(['file', 'video']);
  })
  .command('json2nist [file] [meta]', 'Convert JSON to NIST', () => {
    yargs.positional('file', {
      description: 'JSON file to parse',
      type: 'string',
    });
    yargs.positional('meta', {
      description: 'meta file to get video file name',
      type: 'string',
    });
    yargs.demandOption(['file', 'meta']);
  })
  .command('checkmedia [file]', 'Run checkMedia', () => {
    yargs.positional('file', {
      description: 'The video to check',
      type: 'string',
    }).demandOption('file');
  })
  .command('import [path]', 'Import media as new dataset(s)', () => {
    settingsArgs();
    yargs.positional('path', {
      description: 'Media to import: a video, an image-sequence directory, or (with --bulk) a directory whose videos and subdirectories each become a dataset',
      type: 'string',
    }).demandOption('path');
    yargs.option('bulk', {
      describe: 'Import every video file and subdirectory inside path as its own dataset',
      type: 'boolean',
      default: false,
    });
    yargs.option('fps', {
      describe: 'Annotation frame rate for the new dataset(s), capped at the native video rate; videos default to their native rate',
      type: 'number',
    });
    yargs.option('native-playback', {
      describe: 'Skip transcoding; videos play via native frame extraction',
      type: 'boolean',
      default: false,
    });
    yargs.option('frame-label', {
      describe: 'Frame label preset, repeatable: becomes part of the dataset\'s frame label set shown by the annotator\'s frame label mode',
      type: 'string',
    });
    yargs.array('frame-label');
    yargs.option('default-frame-label', {
      describe: 'One of the --frame-label names, applied to the entire dataset as a full-frame track on import',
      type: 'string',
    });
  })
  .command('list-config', 'List viame pipeline configuration', settingsArgs)
  .command('run-pipeline', 'Run a pipeline', () => {
    settingsArgs();
    yargs.option('id', {
      describe: 'dataset id',
    });
    yargs.option('pipe', {
      describe: 'pipe filename',
    });
    yargs.option('type', {
      describe: 'Pipeline type',
    });
    yargs.demandOption(['type', 'pipe', 'id']);
  })
  .command('run-training', 'Run training', () => {
    settingsArgs();
    yargs.option('id', {
      describe: 'One or more dataset IDs to train on',
    }).array('id');
    yargs.option('config', {
      describe: 'Training configuration file',
    });
    yargs.option('name', {
      describe: 'New pipeline name created by training',
    });
    yargs.option('annotatedFramesOnly', {
      describe: 'Train only on annotated frames',
      type: 'boolean',
      default: false,
    });
    yargs.demandOption(['id', 'config', 'name']);
  })
  .command('stats', 'Show stats on existing data', () => {
    settingsArgs();
  })
  .demandCommand()
  .help();

function getSettings() {
  const platform = getCurrentPlatform();
  return {
    platform,
    ...platform.DefaultSettings,
    dataPath: argv.datapath as string || platform.DefaultSettings.dataPath,
    viamePath: argv.viamepath as string || platform.DefaultSettings.viamePath,
  };
}

if (argv._.includes('viame2json')) {
  parseViameFile(argv.file as string);
} else if (argv._.includes('json2viame')) {
  parseJsonFile(argv.file as string, argv.meta as string);
} else if (argv._.includes('kpf2json')) {
  const run = async () => {
    const kpf = await KPF.parse([
      argv.activityFile as string,
      argv.geometryFile as string,
      argv.typeFile as string,
    ]);
    stdout.write(JSON.stringify(kpf));
  };
  run();
} else if (argv._.includes('nist2json')) {
  const run = async () => {
    const mediaInfo = await checkMedia(argv.video as string);
    const bounds: RectBounds = [
      0, 0, mediaInfo.videoDimensions.width, mediaInfo.videoDimensions.height,
    ];
    parseNistFile(argv.file as string, bounds);
  };
  run();
} else if (argv._.includes('json2nist')) {
  convertJSONtoNist(argv.file as string, argv.meta as string);
} else if (argv._.includes('checkmedia')) {
  const run = async () => {
    const out = await checkMedia(argv.file as string);
    // eslint-disable-next-line no-console
    console.log(out);
  };
  run();
} else if (argv._.includes('import')) {
  const settings = getSettings();
  const run = async () => {
    const presets = parseFrameLabelPresets(
      (argv.frameLabel ?? []) as string[],
      argv.defaultFrameLabel as string | undefined,
    );
    const root = npath.resolve(argv.path as string);

    const targets: string[] = [];
    if (argv.bulk) {
      const children = await fs.readdir(root, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      children.forEach((child) => {
        if (child.isDirectory()) {
          targets.push(npath.join(root, child.name));
        } else {
          const mimetype = mime.lookup(child.name);
          if (mimetype && (websafeVideoTypes.includes(mimetype)
            || otherVideoTypes.includes(mimetype))) {
            targets.push(npath.join(root, child.name));
          }
        }
      });
      if (targets.length === 0) {
        throw new Error(`No videos or subdirectories to import in ${root}`);
      }
    } else {
      targets.push(root);
    }

    // Imports run sequentially: concurrent imports can fail behind the scenes.
    /* eslint-disable no-restricted-syntax, no-await-in-loop */
    for (const target of targets) {
      try {
        const payload = await common.beginMediaImport(target);
        if (argv.fps) {
          payload.jsonMeta.fps = argv.fps as number;
        } else if (payload.jsonMeta.type === 'video' && payload.jsonMeta.originalFps > 0) {
          payload.jsonMeta.fps = payload.jsonMeta.originalFps;
        }
        if (argv.nativePlayback) {
          payload.useNativePlayback = true;
        }
        const conversionArgs = await common.finalizeMediaImport(settings, payload);
        const datasetId = conversionArgs.meta.id;
        await applyFrameLabelPresets(settings, datasetId, presets);
        if (conversionArgs.mediaList.length > 0) {
          stdout.write(`Transcoding media for ${conversionArgs.meta.name}...\n`);
          await new Promise((resolve, reject) => {
            convertMedia(
              settings,
              conversionArgs,
              updater,
              (jobKey, meta) => {
                common.completeConversion(settings, datasetId, jobKey, meta)
                  .then(resolve, reject);
              },
              (_jobKey, meta, errorMessage) => {
                common.failConversion(settings, datasetId, meta, errorMessage)
                  .then(() => reject(new Error(errorMessage)), reject);
              },
              true,
            ).catch(reject);
          });
        }
        stdout.write(`Imported ${conversionArgs.meta.name} as ${datasetId}\n`);
      } catch (err) {
        stderr.write(`Failed to import ${target}: ${err}\n`);
        if (!argv.bulk) {
          process.exitCode = 1;
        }
      }
    }
    /* eslint-enable no-restricted-syntax, no-await-in-loop */
  };
  run();
} else if (argv._.includes('list-config')) {
  const settings = getSettings();
  const run = async () => {
    const pipelines = await common.getPipelineList(settings);
    const trainingConfig = await common.getTrainingConfigs(settings);
    stdout.write(JSON.stringify({
      pipelines,
      trainingConfig,
    }, undefined, 2));
  };
  run();
} else if (argv._.includes('run-pipeline')) {
  const settings = getSettings();
  const pipeargs: RunPipeline = {
    datasetId: argv.id as string,
    pipeline: {
      name: 'cli',
      pipe: argv.pipe as string,
      type: argv.type as string,
    },
  };
  const run = async () => {
    const job = await settings.platform.runPipeline(settings, pipeargs, updater);
    stdout.write(JSON.stringify(job, undefined, 2));
  };
  run();
} else if (argv._.includes('run-training')) {
  const settings = getSettings();
  const trainargs: RunTraining = {
    datasetIds: argv.id as string[],
    trainingConfig: argv.config as string,
    pipelineName: argv.name as string,
    annotatedFramesOnly: argv.annotatedFramesOnly as boolean,
  };
  const run = async () => {
    const job = await settings.platform.train(settings, trainargs, updater);
    stdout.write(JSON.stringify(job, undefined, 2));
  };
  run();
} else if (argv._.includes('stats')) {
  const settings = getSettings();
  const dspath = npath.join(settings.dataPath, common.ProjectsFolderName);
  const run = async () => {
    const dsids = await fs.readdir(dspath);
    const good: unknown[] = [];
    await Promise.all(dsids.map(async (id) => {
      try {
        const proj = await common.getValidatedProjectDir(settings, id);
        const meta = await common.loadJsonMetadata(proj.metaFileAbsPath);
        const tracks = await common.loadAnnotationFile(proj.trackFileAbsPath);
        const tracklist = Object.values(tracks);
        const hydrated = tracklist.map((t) => Track.fromJSON(t));
        const labels = new Set<string>();
        hydrated.forEach((t) => t.confidencePairs.forEach((cp) => {
          labels.add(cp[0]);
        }));
        good.push({
          name: meta.name,
          id: meta.id,
          type: meta.type,
          imageCount: meta.originalImageFiles.length,
          txImageCount: meta.transcodedImageFiles?.length,
          originalVideoFile: meta.originalVideoFile,
          txVideoFile: meta.transcodedVideoFile,
          tracks: tracklist.length,
          features: tracklist.map((t) => t.features).length,
          labels: Array.from(labels),
        });
      } catch (err) {
        stderr.write(`Invalid project: ${id}: ${err}\n`);
      }
    }));
    stdout.write(JSON.stringify(good, undefined, 2));
  };
  run();
} else {
  stdout.write(`Invalid command: ${argv._}\n`);
  yargs.showHelp();
}
