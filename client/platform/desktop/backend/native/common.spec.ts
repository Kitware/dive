/// <reference types="jest" />
import mockfs from 'mock-fs';
import npath from 'path';
import fs from 'fs-extra';
import { Console } from 'console';

import type { JsonMeta, Settings } from 'platform/desktop/constants';

import common from './common';

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
    expect(pipes.training).toBeUndefined();
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
    const meta = await common.importMedia(settings, '/home/user/data/imageSuccess');
    expect(meta.name).toBe('imageSuccess');
    expect(meta.originalImageFiles.length).toBe(2);
    expect(meta.originalVideoFile).toBe('');
    expect(meta.originalBasePath).toBe('/home/user/data/imageSuccess');
  });

  it('importMedia video success', async () => {
    const meta = await common.importMedia(settings, '/home/user/data/videoSuccess/video1.mp4');
    expect(meta.name).toBe('video1');
    expect(meta.originalImageFiles.length).toBe(0);
    expect(meta.originalVideoFile).toBe('video1.mp4');
    expect(meta.originalBasePath).toBe('/home/user/data/videoSuccess');
  });

  it('importMedia various failure modes', async () => {
    await expect(common.importMedia(settings, '/fake/path'))
      .rejects.toThrow('file or directory not found');
    await expect(common.importMedia(settings, '/home/user/data/imageSuccess/foo.png'))
      .rejects.toThrow('chose image file for video import option');
    await expect(common.importMedia(settings, '/home/user/data/videoSuccess/otherfile.txt'))
      .rejects.toThrow('unsupported MIME type');
    await expect(common.importMedia(settings, '/home/user/data/videoSuccess/video1.avi'))
      .rejects.toThrow('unsupported MIME type');
    await expect(common.importMedia(settings, '/home/user/data/videoSuccess/nomime'))
      .rejects.toThrow('could not determine video MIME');
    await expect(common.importMedia(settings, '/home/user/data/annotationFail/video1.mp4'))
      .rejects.toThrow('too many CSV');
  });
});

afterAll(() => {
  mockfs.restore();
});
