/// <reference types="jest" />
import mockfs from 'mock-fs';
import npath from 'path';
import fs from 'fs-extra';
import { Console } from 'console';

import type {
  ConversionArgs,
  DesktopJob,
  DesktopJobUpdate, DesktopJobUpdater, JsonMeta, RunTraining, Settings,
} from 'platform/desktop/constants';

import { Attribute } from 'viame-web-common/apispec';
import * as common from './common';

const pipelines = {
  'classify_detections_svm.pipe': '',
  'common_generic_detector_with_filter.pipe': '',
  'common_image_stabilizer.pipe': '',
  'common_short_term_tracker.pipe': '',
  'common_stabilized_iou_tracker.pipe': '',
  'database_apply_svm_models.pipe': '',
  'detector_default.pipe': '',
  'detector_extract_chips.pipe': '',
  'detector_generic.pipe': '',
  'detector_local.pipe': '',
  'detector_local_left.pipe': '',
  'detector_simple_hough.pipe': '',
  'detector_svm_models.pipe': '',
  'display_annotations.pipe': '',
  'draw_detections_on_images.pipe': '',
  'extract_chips_from_detections.pipe': '',
  'filter_debayer_and_enhance.pipe': '',
  'filter_enhance.pipe': '',
  'filter_extract_left.pipe': '',
  'filter_split_and_debayer.pipe': '',
  'filter_to_kwa.pipe': '',
  'full_frame_classifier_local.pipe': '',
  'full_frame_classifier_svm.pipe': '',
  'generate_empty_frame_lbls_1fr.pipe': '',
  'generate_empty_frame_lbls_10fr.pipe': '',
  'generate_empty_frame_lbls_100fr.pipe': '',
  'generate_empty_frame_lbls_1000fr.pipe': '',
  'index_default.pipe': '',
  'index_default.svm.pipe': '',
  'index_default.trk.pipe': '',
  'index_existing.pipe': '',
  'smqtk_query.pipe': '',
  'smqtk_train_itq.json': '',
  'sql_init_table.sql': '',
  'tracker_default.pipe': '',
  'tracker_default.sfd.pipe': '',
  'tracker_generic.pipe': '',
  'tracker_local.pipe': '',
  'tracker_short_term.pipe': '',
  'tracker_stabilized_iou.pipe': '',
  'tracker_svm_models.pipe': '',
  'train_color_freq_aug.pipe': '',
  'train_hue_shifting_only_aug.pipe': '',
  'train_intensity_color_freq_motion_aug.pipe': '',
  'train_intensity_hue_motion_aug.pipe': '',
  'train_mmdet_cascade.habcam.conf': '',
  'train_mmdet_cascade.viame_csv.conf': '',
  'train_mmdet_cascade_icm.viame_csv.conf': '',
  'train_mmdet_cascade_ihm.viame_csv.conf': '',
  'train_motion_and_color_freq_aug.pipe': '',
  'train_motion_aug.pipe': '',
  'train_netharn_cascade.habcam.conf': '',
  'train_netharn_cascade.viame_csv.conf': '',
};

const settings: Settings = {
  version: 1,
  dataPath: '/home/user/viamedata',
  viamePath: '/opt/viame',
};
const urlMapper = (a: string) => `http://localhost:8888/api/media?path=${a}`;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const updater = (update: DesktopJobUpdate) => undefined;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const checkMedia = async (settingsVal: Settings, file: string) => file.includes('mp4');
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const convertMedia = async (settingsVal: Settings, args: ConversionArgs,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updaterFunc: DesktopJobUpdater) => ({
  key: 'jobKey',
  title: 'title',
  command: 'command',
  args: {},
  jobType: 'conversion',
  datasetIds: ['datasetId'],
  pid: 1234,
  workingDir: 'workingdir',
  exitCode: null,
  startTime: new Date(),
} as DesktopJob);
// https://github.com/tschaub/mock-fs/issues/234
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const console = new Console(process.stdout, process.stderr);

mockfs({
  '/opt/viame': {
    configs: {
      pipelines: {
        models: {},
        templates: {},
        ...pipelines,
      },
    },
  },
  '/home/user/data': {
    imageSuccess: {
      'foo.png': '',
      'bar.png': '',
      notanimage: '',
      'notanimage.txt': '',
    },
    metaAttributesID: {
      'foo.png': '',
      'bar.png': '',
      notanimage: '',
      'notanimage.txt': '',
    },
    videoSuccess: {
      'video1.avi': '',
      'video1.mp4': '',
      'otherfile.txt': '',
      nomime: '',
    },
    annotationFail: {
      'video1.mp4': '',
      'file1.csv': '',
      'file2.csv': '',
    },
  },
  '/home/user/viamedata': {
    // eslint-disable-next-line @typescript-eslint/camelcase
    DIVE_Jobs: {
      goodTrainingJob: {
        // eslint-disable-next-line @typescript-eslint/camelcase
        category_models: {
          'detector.pipe': '',
          'trained_detector.zip': '',
        },
      },
      badTrainingJob: {
        missingModelFolder: {},
      },
      missingPipeTrainingJob: {
        // eslint-disable-next-line @typescript-eslint/camelcase
        category_models: {
          'trained_detector.zip': '',
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/camelcase
    DIVE_Pipelines: {
      /* Empty */
    },
    // eslint-disable-next-line @typescript-eslint/camelcase
    DIVE_Projects: {
      projectid1: {
        'meta.json': JSON.stringify({
          version: 1,
          id: 'projectid1',
          type: 'image-sequence',
          fps: 5,
          originalBasePath: '/home/user/media/projectid1data',
          originalImageFiles: [
            'foo.png',
            'bar.png',
          ],
        } as JsonMeta),
        'result_whatever.json': JSON.stringify({}),
        auxiliary: {},
      },
      projectid1VideoGood: {
        'meta.json': JSON.stringify({
          version: 1,
          id: 'projectid1',
          type: 'video',
          fps: 5,
          originalVideoFile: 'whatever.mp4',
          transcodedVideoFile: 'whatever-transcoded.mp4',
        } as JsonMeta),
        'result_whatever.json': JSON.stringify({}),
        auxiliary: {},
      },
      projectid2Bad: {
        'meta.json': '{}',
        // Won't match
        'results_invalid.json': '',
        auxiliary: {},
      },
      projectid3Bad: {},
      projectid4Bad: {
        'meta.json': '{}',
        // Too many results
        'result_1.json': '',
        'result_2.json': '',
        auxiliary: {},
      },
      metaAttributesID: {
        'meta.json': JSON.stringify({
          version: 1,
          id: 'metaAttributesID',
          type: 'image-sequence',
          fps: 5,
          originalBasePath: '/home/user/media/metaAttributesID',
          originalImageFiles: [
            'foo.png',
            'bar.png',
          ],
          attributes: {
            // eslint-disable-next-line @typescript-eslint/camelcase
            track_attribute1: {
              belongs: 'track',
              datatype: 'text',
              values: ['value1', 'value2', 'value3'],
              name: 'attribute1',
              _id: 'track_attribute1',
            },
            // eslint-disable-next-line @typescript-eslint/camelcase
            detection_attribute1: {
              belongs: 'detection',
              datatype: 'number',
              name: 'attribute1',
              _id: 'detection_attribute1',
            },
          },
        }),
        'result_whatever.json': JSON.stringify({}),
        auxiliary: {},
      },
    },
  },
});

describe('native.common', () => {
  it('getPipelineList lists pipelines', async () => {
    const exists = await fs.pathExists(settings.viamePath);
    expect(exists).toBe(true);
    const pipes = await common.getPipelineList(settings);
    expect(pipes).toBeTruthy();
    expect(pipes.detector.pipes).toHaveLength(4);
    expect(pipes.tracker.pipes).toHaveLength(5);
    expect(pipes.generate.pipes).toHaveLength(4);
    expect(pipes.trained).toBeUndefined();
  });

  it('getValidatedProjectDir loads correct project directory', async () => {
    const basedir = 'DIVE_Projects/projectid1';
    const dir = await common.getValidatedProjectDir(settings, 'projectid1');
    expect(dir.basePath).toBe(npath.join(settings.dataPath, basedir));
    expect(dir.metaFileAbsPath).toBe(npath.join(settings.dataPath, basedir, 'meta.json'));
    expect(dir.auxDirAbsPath).toBe(npath.join(settings.dataPath, basedir, 'auxiliary'));
    expect(dir.trackFileAbsPath).toBe(npath.join(settings.dataPath, basedir, 'result_whatever.json'));
  });

  it('getValidatedProjectDir fails to load project directory for invalid contents', async () => {
    await expect(common.getValidatedProjectDir(settings, 'projectid2Bad'))
      .rejects.toThrow('missing track json file');
    await expect(common.getValidatedProjectDir(settings, 'projectid3Bad'))
      .rejects.toThrow('missing metadata json file');
    await expect(common.getValidatedProjectDir(settings, 'projectid4Bad'))
      .rejects.toThrow('too many matches');
  });

  it('loadJsonMetadata loads metadata from file', async () => {
    const data = await common.loadMetadata(settings, 'projectid1', urlMapper);
    expect(data.id).toBe('projectid1');
    expect(data.imageData.map(({ filename }) => filename)).toEqual([
      'foo.png', 'bar.png',
    ]);
  });

  it('loadJsonMetadata prefers transcoded media when it exists', async () => {
    const data = await common.loadMetadata(settings, 'projectid1VideoGood', urlMapper);
    const videoPath = npath.join(
      settings.dataPath, 'DIVE_Projects', 'projectid1VideoGood', 'whatever-transcoded.mp4',
    );
    expect(data.videoUrl).toBe(`http://localhost:8888/api/media?path=${videoPath}`);
  });

  it('createKwiverRunWorkingDir creates pipeline run directories', async () => {
    await expect(common.createKwiverRunWorkingDir(settings, [], 'whatever.pipe'))
      .rejects.toThrow('At least 1 jsonMeta item');
    const jsonMeta: JsonMeta = {
      version: 1,
      type: 'image-sequence',
      fps: 100,
      name: 'myproject1_name',
      createdAt: (new Date()).toString(),
      originalBasePath: '/foo/bar/baz',
      id: 'myproject1',
      originalImageFiles: [],
      originalVideoFile: '',
    };
    const result = await common.createKwiverRunWorkingDir(settings, [jsonMeta], 'mypipeline.pipe');
    const stat = fs.statSync(result);
    const contents = fs.readdirSync(result);
    expect(stat.isDirectory()).toBe(true);
    expect(contents).toEqual([]);
    expect(result).toMatch(/DIVE_Jobs\/myproject1_name_mypipeline\.pipe_/);
  });

  it('importMedia image sequence success', async () => {
    const meta = await common.importMedia(settings, '/home/user/data/imageSuccess', updater, { checkMedia, convertMedia });
    expect(meta.name).toBe('imageSuccess');
    expect(meta.originalImageFiles.length).toBe(2);
    expect(meta.originalVideoFile).toBe('');
    expect(meta.originalBasePath).toBe('/home/user/data/imageSuccess');
  });

  it('importMedia video success', async () => {
    const meta = await common.importMedia(settings, '/home/user/data/videoSuccess/video1.mp4', updater, { checkMedia, convertMedia });
    expect(meta.name).toBe('video1');
    expect(meta.originalImageFiles.length).toBe(0);
    expect(meta.originalVideoFile).toBe('video1.mp4');
    expect(meta.originalBasePath).toBe('/home/user/data/videoSuccess');
  });

  it('importMedia various failure modes', async () => {
    await expect(common.importMedia(settings, '/fake/path', updater, { checkMedia, convertMedia }))
      .rejects.toThrow('file or directory not found');
    await expect(common.importMedia(settings, '/home/user/data/imageSuccess/foo.png', updater, { checkMedia, convertMedia }))
      .rejects.toThrow('chose image file for video import option');
    await expect(common.importMedia(settings, '/home/user/data/videoSuccess/otherfile.txt', updater, { checkMedia, convertMedia }))
      .rejects.toThrow('unsupported MIME type');
    await expect(common.importMedia(settings, '/home/user/data/videoSuccess/nomime', updater, { checkMedia, convertMedia }))
      .rejects.toThrow('could not determine video MIME');
    await expect(common.importMedia(settings, '/home/user/data/annotationFail/video1.mp4', updater, { checkMedia, convertMedia }))
      .rejects.toThrow('too many CSV');
  });

  it('importMedia video, start conversion', async () => {
    const meta = await common.importMedia(settings, '/home/user/data/videoSuccess/video1.avi', updater, { checkMedia, convertMedia });
    expect(meta.transcodingJobKey).toBe('jobKey');
    expect(meta.type).toBe('video');
  });

  it('processing good Trained Pipeline folder', async () => {
    const trainingArgs: RunTraining = {
      datasetIds: ['randomID'],
      pipelineName: 'trainedPipelineName',
      trainingConfig: 'trainingConfig',
    };
    const contents = await common.processTrainedPipeline(settings, trainingArgs, '/home/user/viamedata/DIVE_Jobs/goodTrainingJob/');
    expect(contents).toEqual(['detector.pipe', 'trained_detector.zip']);
    //Data should be moved out of the current folder
    const sourceFolder = fs.readdirSync('/home/user/viamedata/DIVE_Jobs/goodTrainingJob/category_models');
    expect(sourceFolder.length).toBe(0);
    //Folders hould be created for new pipeline
    const pipelineFolder = '/home/user/viamedata/DIVE_Pipelines/trainedPipelineName';
    const exists = fs.existsSync(pipelineFolder);
    expect(exists).toBe(true);
    const folderContents = fs.readdirSync(pipelineFolder);
    expect(folderContents.length).toBe(2);
  });

  it('processing bad Trained Pipeline folders', async () => {
    const trainingArgs: RunTraining = {
      datasetIds: ['randomID'],
      pipelineName: 'trainedBadPipelineName',
      trainingConfig: 'trainingConfig',
    };
    expect(common.processTrainedPipeline(settings, trainingArgs, '/home/user/viamedata/DIVE_Jobs/badTrainingJob/')).rejects.toThrow(
      'Path: /home/user/viamedata/Dive_Jobs/badTrainingJob/category_models does not exist',
    );
    expect(common.processTrainedPipeline(settings, trainingArgs, '/home/user/viamedata/DIVE_Jobs/missingPipeTrainingJob/')).rejects.toThrow(
      'Could not located trained pipe file inside of /home/user/viamedata/Dive_Jobs/missingPipeTrainingJob/category_models',
    );
  });

  it('getPipelineList lists pipelines with Trained pipelines', async () => {
    const exists = await fs.pathExists(settings.viamePath);
    expect(exists).toBe(true);
    const pipes = await common.getPipelineList(settings);
    expect(pipes).toBeTruthy();
    expect(pipes.detector.pipes).toHaveLength(4);
    expect(pipes.tracker.pipes).toHaveLength(5);
    expect(pipes.generate.pipes).toHaveLength(4);
    expect(pipes.trained.pipes).toHaveLength(1);
  });

  it('getAtributes', async () => {
    const meta = await common.getAttributes(settings, 'metaAttributesID');
    //Should return an array of data items
    expect(meta.length).toBe(2);
    expect(meta[0].values).toEqual(['value1', 'value2', 'value3']);
    expect(meta[1].datatype).toBe('number');
  });

  it('addAttribute', async () => {
    const templateAttribute: Attribute = {
      name: 'newAttribute', datatype: 'boolean', belongs: 'track', _id: '',
    };
    await common.setAttribute(settings, 'metaAttributesID', {
      data: templateAttribute,
    });
    //Should return an array of data items
    const meta = await common.getAttributes(settings, 'metaAttributesID');
    const newAttribute = meta.find((item) => item.name === 'newAttribute');
    expect(meta.length).toBe(3);
    expect(newAttribute).toEqual(templateAttribute);
  });

  it('updateAttribute', async () => {
    const templateAttribute: Attribute = {
      name: 'newAttributeName', datatype: 'boolean', belongs: 'track', _id: 'track_attribute1',
    };
    await common.setAttribute(settings, 'metaAttributesID', {
      data: templateAttribute,
    });
    //Should return an array of data items
    const meta = await common.getAttributes(settings, 'metaAttributesID');
    const updatedAttribute = meta.find((item) => item._id === 'track_attribute1');
    expect(meta.length).toBe(3);
    expect(updatedAttribute).toEqual(templateAttribute);
  });

  it('deleteAttribute', async () => {
    const deleteAttribute: Attribute = {
      name: 'attribute1', datatype: 'text', belongs: 'track', _id: 'track_attribute1',
    };
    await common.deleteAttribute(settings, 'metaAttributesID', { data: deleteAttribute });
    const meta = await common.getAttributes(settings, 'metaAttributesID');
    //Should return an array of data items
    expect(meta.length).toBe(2);
    expect(meta[0].datatype).toBe('number');
  });

  it('initial attribute creation', async () => {
    const templateAttribute: Attribute = {
      name: 'newAttribute', datatype: 'boolean', belongs: 'track', _id: '',
    };
    await common.setAttribute(settings, 'projectid1VideoGood', {
      data: templateAttribute,
    });
    const meta = await common.getAttributes(settings, 'projectid1VideoGood');
    expect(meta.length).toBe(1);
    expect(meta[0]).toEqual(templateAttribute);
  });
});

afterAll(() => {
  mockfs.restore();
});
