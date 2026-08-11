import mockfs from 'mock-fs';
import npath from 'path';
import fs from 'fs-extra';
import { Console } from 'console';

import {
  AnnotationsCurrentVersion, DesktopJob,
  DesktopJobUpdate, JobType, JsonConfig, ProjectsFolderName, RunTraining, Settings,
} from 'platform/desktop/constants';
import { makeEmptyAnnotationFile } from 'platform/desktop/backend/serializers/dive';

import { CameraCorrespondences, MultiTrackRecord } from 'dive-common/apispec';
import { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { getResponseError } from 'vue-media-annotator/utils';
import * as common from './common';
import { createWorkingDirectory, buildTrainingExitManifest } from './utils';
import beginMultiCamImport from './multiCamImport';

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra') & { default: typeof import('fs-extra') }>('fs-extra');
  const fsNode = await import('node:fs');
  const existsByStat = (targetPath: Parameters<typeof fsNode.statSync>[0]) => {
    try {
      fsNode.statSync(targetPath);
      return true;
    } catch {
      return false;
    }
  };

  const patchedDefault = {
    ...actual.default,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };

  return {
    ...actual,
    default: patchedDefault,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };
});

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
  'utility_empty_frame_lbls_1fr.pipe': '',
  'utility_empty_frame_lbls_10fr.pipe': '',
  'utility_empty_frame_lbls_100fr.pipe': '',
  'utility_empty_frame_lbls_1000fr.pipe': '',
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
  readonlyMode: false,
  overrides: {},
};
const urlMapper = (a: string) => `http://localhost:8888/api/media?path=${a}`;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const updater = (update: DesktopJobUpdate) => undefined;

vi.mock('./mediaJobs', () => ({
  checkMedia: vi.fn((file: string) => Promise.resolve({
    websafe: file.includes('mp4'),
    originalFpsString: '30/1',
    originalFps: 30,
    videoDimensions: { width: 1920, height: 1080 },
  })),
  convertMedia: vi.fn(() => ({
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
  } as DesktopJob)),
}));
// https://github.com/tschaub/mock-fs/issues/234
const console = new Console(process.stdout, process.stderr);

const emptyCsvString = '# comment line\n# metadata,fps: 32,"whatever"\n#comment line';

function cocoWithRle(trackId: number, categoryName = 'fish') {
  return JSON.stringify({
    images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 0 }],
    annotations: [{
      id: trackId,
      image_id: 1,
      category_id: 5,
      bbox: [10, 20, 30, 40],
      track_id: trackId,
      iscrowd: 1,
      segmentation: { size: [100, 100], counts: 'abc' },
    }],
    categories: [{ id: 5, name: categoryName }],
  });
}

function cocoWithHierarchy(trackId: number, child: string, parent: string) {
  return {
    images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 0 }],
    annotations: [{
      id: trackId,
      image_id: 1,
      category_id: 2,
      bbox: [10, 20, 30, 40],
      track_id: trackId,
    }],
    categories: [
      { id: 1, name: parent },
      { id: 2, name: child, supercategory: parent },
    ],
  };
}

// Below sets up data in the mockfs
type testPairs = [string[], MultiTrackRecord, Record<string, Attribute>];
/* Viame.spec.json is an array in the format [CSV row Array, MultiTrackRecord, Attributes Object][]
   This is restructured to be images and annotations files within a folder for the mockfs system
   test[index] (folder):
      -1.png
      -2.png
      -3.png
      -annotations.csv
  This is then used to run a complete load of a folder and then compare
  with the results located in the MultiTrackRecord and Attributes for the corresponding index
*/
const testData: testPairs[] = fs.readJSONSync('../testutils/viame.spec.json');
const images: Record<string, string> = {};
//Create a list of numbers 0-9
const imageList = Array.from(Array(10).keys());
imageList.shift(); //remove 0 to line up with source data images list
// eslint-disable-next-line no-return-assign
imageList.forEach((item) => images[`${item}.png`] = ''); // 1.png, 2.png,...
//Create a mockfs file struction of a list of images and a root annotations.csv file
const fileSystemData: Record<string, Record<string, string>> = { };
testData.forEach((triplet, index) => {
  fileSystemData[`test${index}`] = {
    ...images, //list of images [1-9].png
    'annotations.csv': triplet[0].join('\n'), //join csv string[] into a string for mockfs
  };
});

beforeEach(() => {
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
    '/home/user/testPairs': { ...fileSystemData },
    '/home/user/output': {},
    '/home/user/transformDiscovery': {
      exactName: {
        'aaa-stamped.json': JSON.stringify({ type: 'dive-camera-registration', version: 1, pairs: [] }),
        'calibration.json': JSON.stringify({ type: 'dive-camera-registration', version: 1, pairs: [] }),
      },
      otherName: {
        'a-rig-calibration.json': JSON.stringify({ calibrations: {} }),
        'broken.json': '{not json',
        'z-transforms.json': JSON.stringify({ type: 'dive-camera-registration', version: 1, pairs: [] }),
      },
      perCamera: {
        'uv_to_eo_registration.json': JSON.stringify({ type: 'dive-camera-registration', version: 1, pairs: [] }),
        'ir_to_eo_registration.json': JSON.stringify({ type: 'dive-camera-registration', version: 1, pairs: [] }),
        'stray.json': JSON.stringify({ some: 'thing' }),
      },
      untypedPerCamera: {
        'uv_to_eo_registration.json': JSON.stringify({ version: 1, pairs: [] }),
        'no_pairs_registration.json': JSON.stringify({ version: 1 }),
        'untyped-other-name.json': JSON.stringify({ version: 1, pairs: [] }),
      },
      none: {
        'rig.json': JSON.stringify({ some: 'thing' }),
        'notes.txt': 'not json',
      },
    },
    '/home/user/data': {
      annotationImport: {
        'viame.csv': emptyCsvString,
        'foreign.meta.json': '{ "confidenceFilters": {"default": 0.8}, "type": "invalidtype" }',
        'foreign.meta.withExtras.json': JSON.stringify({
          confidenceFilters: { default: 0.8 },
          customTypeStyling: { fish: { color: 'green' } },
          imageEnhancements: { brightness: 1.1 },
          cameraHomographies: {
            'left::right': {
              AtoB: [[9, 0, 0], [0, 9, 0], [0, 0, 1]],
              BtoA: [[9, 0, 0], [0, 9, 0], [0, 0, 1]],
            },
          },
          cameraCorrespondences: { 'left::right': [{ id: 9, a: [9, 9], b: [8, 8] }] },
          cameraTransformTypes: { 'left::right': 'affine' },
          cameraRegistrationSource: { model: 'from-import' },
        }),
        'dataset-info.config.json': JSON.stringify({
          datasetInfo: {
            year: '2025',
            gfishsite_id: '2024TXN012',
          },
        }),
        // This file will be migrated
        'dive.json': '{ "0": { "trackId": 0 } }', // fake track file
      },
      imageSuccess: {
        'foo.png': '',
        'bar.png': '',
        notanimage: '',
        'notanimage.txt': '',
      },
      imageLists: {
        success: {
        // bad sort order
          'image_list.txt': 'image3.png\r\n/home/user/data/imageLists/success/image2.png\n\n\nimage4.png\n../success/image1.png',
          'image1.png': '',
          'image3.png': '',
          'image2.png': '',
          'image4.png': '',
        },
        successGlob: {
          'image_list.txt': './2018-image2.png\n./nested/2018-image1.png\n./2019-image0.png',
          '2018-image2.png': '',
          '2019-image0.png': '',
          nested: {
            '2018-image1.png': '',
          },
        },
        failEmptyRelative: {
          'image_list.txt': '\nimage1.png\nimage2.png',
        },
        failEmptyAbsolute: {
          'name-not-important.txt': 'image1.png\n/bad/path/image2.png',
          'image1.png': '',
          'image2.png': '',
        },
        failEmptyList: {
          'image_list.txt': '\n\n\r\n',
        },
        failInvalidImageMIME: {
          'image_list.txt': '\nimage1.png\nimage2.txt',
          'image1.png': '',
          'image2.txt': '',
        },
      },
      metaAttributesID: {
        'foo.png': '',
        'bar.png': '',
        notanimage: '',
        'notanimage.txt': '',
      },
      imageSuccessWithAnnotations: {
        'foo.png': '',
        'bar.png': '',
        'file1.csv': emptyCsvString,
      },
      videoSuccess: {
        'video1.avi': '',
        'video1.mp4': '',
        'otherfile.txt': '',
        nomime: '',
      },
      metaJsonIncluded: {
        'video1.avi': '',
        'video1.mp4': '',
        'meta.json': '{ "confidenceFilters": {"default": 0.8}, "customTypeStyling": {"other": { "color": "blue"}}, "attributes": {"track_NewTrackAttribute":{"belongs":"track","datatype":"text","values":[],"name":"NewTrackAttribute","key":"track_NewTrackAttribute"}}}',
        nomime: '',
      },
      annotationEmptySuccess: {
        'video1.mp4': '',
        'result_foo.json': '',
      },
      multiCSV: {
        'video1.mp4': '',
        'file1.csv': '',
        'file2.csv': '',
      },
      frameMetadataSource: {
        'image_0001.jpg': '',
        'image_0002.jpg': '',
        'image_0003.jpg': '',
        'frame-metadata.txt': [
          'filename,depth,temperature',
          'image_0001.jpg,192.80,4.0',
          'image_0002.jpg,193.10,4.1',
          'image_0003.jpg,193.40,4.2',
          '',
        ].join('\n'),
      },
      videoMetadataSource: {
        'movie.mp4': '',
        'frame_metadata.csv': 'frame,depth\n0,10\n2,30\n',
      },
      multicamVideoMetadata: {
        'frame_metadata.csv': 'frame,depth\n0,shared\n2,long-camera\n',
        left: {
          'left.mp4': '',
        },
        right: {
          'right.mp4': '',
        },
      },
      // Two reserved-name attachments in one folder: read-time discovery reports the
      // ambiguity instead of choosing one or merging them.
      frameMetadataAmbiguous: {
        'image_0001.jpg': '',
        'frame-metadata.txt': 'filename,depth\nimage_0001.jpg,10\n',
        'frame_metadata.csv': 'filename,depth\nimage_0001.jpg,99\n',
      },
      // An exported dataset folder: the attachment travels under metadata/ and meta.json
      // carries only the exporting server's item id, which import must ignore.
      archiveDataset: {
        'image_0001.jpg': '',
        'meta.json': JSON.stringify({ metadataFileItemId: '64b8f0c2e1d3a40001abcdef' }),
        metadata: {
          'flight_log.csv': 'filename,altitude\nimage_0001.jpg,120\n',
        },
      },
      // An ordinary media folder that keeps its own metadata/ subdirectory. It is not an export
      // archive -- no meta.json -- so the archive contract must not be applied to its contents.
      metadataSubdirectory: {
        'image_0001.jpg': '',
        metadata: {
          'exif.xml': '<exif/>',
          'notes.xml': '<notes/>',
        },
      },
      // An attachment the user picks in the dialog, named nothing like a reserved sidecar.
      explicitMetadata: {
        'flight_log.json': '{"rows": []}',
      },
      // Keyword multicam import: originalBasePath holds the image-list FILE, not a directory.
      multicamImageList: {
        'image_list.txt': 'img_l1.jpg\nimg_r1.jpg\n',
        'img_l1.jpg': '',
        'img_r1.jpg': '',
        'frame_metadata.csv': 'filename,depth\nimg_l1.jpg,10\n',
      },
      // Multicam with an explicit shared attachment and a camera-local reserved-name one.
      multicamExplicitShared: {
        left: { 'img_l1.jpg': '' },
        right: {
          'img_r1.jpg': '',
          'frame_metadata.csv': 'filename,depth\nimg_r1.jpg,300\n',
        },
      },
      frameMetadataDoubleExt: {
        'photo.jpg.png': '',
        'frame_metadata.csv': [
          'filename,depth',
          'photo.jpg.png,10',
          '',
        ].join('\n'),
      },
      frameMetadataNoSource: {
        'image_0001.jpg': '',
        'notes.txt': 'note,value\nhello,world\n',
      },
      // Duplicate image basename across subfolders: the read path keys last-wins instead of
      // throwing like the import-path validator.
      frameMetadataDupSource: {
        'frame_metadata.csv': [
          'filename,depth',
          'image_0001.jpg,10',
          'image_0002.jpg,20',
          '',
        ].join('\n'),
      },
      // Multicam whose root (originalBasePath) is also the 'left' camera's media dir; the shared
      // sidecar must be listed once for 'left' and 'right' names other images so it joins nothing.
      multicamRootDedup: {
        'frame_metadata.csv': [
          'filename,depth',
          'img_l1.jpg,100',
          'img_l2.jpg,200',
          '',
        ].join('\n'),
        right: {
          'img_r1.jpg': '',
        },
      },
      // Multicam whose parent root holds one wide sidecar naming both cameras' images; each
      // camera's media lives in its own subfolder, so the shared root file binds both cameras.
      multicamSharedRoot: {
        'frame_metadata.csv': [
          'filename,depth',
          'img_l1.jpg,100',
          'img_l2.jpg,110',
          'img_r1.jpg,300',
          'img_r2.jpg,310',
          '',
        ].join('\n'),
        left: {
          'img_l1.jpg': '',
          'img_l2.jpg': '',
        },
        right: {
          'img_r1.jpg': '',
          'img_r2.jpg': '',
        },
      },
      // Import-gate fixtures.
      fmGateMixed: {
        'image_0001.jpg': '',
        // Sorts first but is declared frame metadata: skipped as a track-file candidate, left on disk.
        'frame_metadata.csv': 'filename,depth\nimage_0001.jpg,10\n',
        'zzz_annotations.csv': '# comment line\n# metadata,fps: 32,"whatever"\n#comment line',
      },
      fmGateFrameMetadataOnly: {
        'image_0001.jpg': '',
        'frame_metadata.csv': 'filename,depth\nimage_0001.jpg,10\n',
      },
      fmGateMultipleMetadata: {
        'image_0001.jpg': '',
        'frame_metadata.csv': 'filename,depth\nimage_0001.jpg,10\n',
        'frame-metadata.json': '{}',
      },
      fmGateExplicit: {
        'frame_metadata.csv': 'filename,depth\nimage_0001.jpg,10\n',
      },
      // A plain CSV (not declared) whose contents fail to parse as VIAME annotations: the error
      // gains the rename hint. The unterminated quote makes csv-parse reject.
      fmGateViameFail: {
        'nav.csv': 'filename,depth\n"unterminated,10\n',
      },
    },
    '/home/user/viamedata': {
      DIVE_Jobs: {
        goodTrainingJob: {
          category_models: {
            'detector.pipe': '',
            'trained_detector.zip': '',
          },
        },
        badTrainingJob: {
          missingModelFolder: {},
        },
        missingPipeTrainingJob: {
          category_models: {
            'trained_detector.zip': '',
          },
        },
      },
      DIVE_Pipelines: {
      /* Empty */
      },
      DIVE_Projects: {
        projectid1: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectid1',
            type: 'image-sequence',
            fps: 5,
            originalBasePath: '/home/user/media/projectid1data',
            originalImageFiles: [
              'foo_20230615_143022.png',
              'bar.png',
            ],
          } as JsonConfig),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectid1VideoGood: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectid1',
            type: 'video',
            fps: 5,
            originalBasePath: '/home/user/data/videoMetadataSource',
            originalVideoFile: 'whatever.mp4',
            transcodedVideoFile: 'whatever-transcoded.mp4',
          } as JsonConfig),
          'result_whatever.json': JSON.stringify({}),
          'whatever-transcoded.mp4': '',
          auxiliary: {},
        },
        projectidMulticamVideoMetadata: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidMulticamVideoMetadata',
            type: 'multi',
            fps: 5,
            originalBasePath: '/home/user/data/multicamVideoMetadata',
            multiCam: {
              defaultDisplay: 'left',
              cameras: {
                left: {
                  type: 'video',
                  originalBasePath: '/home/user/data/multicamVideoMetadata/left',
                  originalVideoFile: 'left.mp4',
                  metadataFile: 'auxiliary/left/local.csv',
                  metadataOriginalName: 'left-local.csv',
                },
                right: {
                  type: 'video',
                  originalBasePath: '/home/user/data/multicamVideoMetadata/right',
                  originalVideoFile: 'right.mp4',
                },
              },
            },
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {
            left: {
              'local.csv': 'frame,depth\n0,local\n',
            },
          },
        },
        projectidFrameMetadata: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidFrameMetadata',
            type: 'image-sequence',
            fps: 5,
            originalBasePath: '/home/user/data/frameMetadataSource',
            originalImageFiles: [
              'image_0001.jpg',
              'image_0002.jpg',
              'image_0003.jpg',
            ],
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectidFrameMetadataAmbiguous: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidFrameMetadataAmbiguous',
            type: 'image-sequence',
            fps: 5,
            originalBasePath: '/home/user/data/frameMetadataAmbiguous',
            originalImageFiles: ['image_0001.jpg'],
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectidMulticamImageList: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidMulticamImageList',
            type: 'multi',
            fps: 5,
            originalBasePath: '/home/user/data/multicamImageList/image_list.txt',
            multiCam: {
              defaultDisplay: 'left',
              cameras: {
                left: {
                  type: 'image-sequence',
                  originalBasePath: '',
                  imageListPath: '/home/user/data/multicamImageList/image_list.txt',
                  originalImageFiles: ['/home/user/data/multicamImageList/img_l1.jpg'],
                },
                right: {
                  type: 'image-sequence',
                  originalBasePath: '',
                  imageListPath: '/home/user/data/multicamImageList/image_list.txt',
                  originalImageFiles: ['/home/user/data/multicamImageList/img_r1.jpg'],
                },
              },
            },
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectidMulticamExplicitShared: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidMulticamExplicitShared',
            type: 'multi',
            fps: 5,
            originalBasePath: '/home/user/data/multicamExplicitShared',
            metadataFile: 'auxiliary/flight_log.csv',
            metadataOriginalName: 'flight_log.csv',
            multiCam: {
              defaultDisplay: 'left',
              cameras: {
                left: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/data/multicamExplicitShared/left',
                  originalImageFiles: ['img_l1.jpg'],
                },
                right: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/data/multicamExplicitShared/right',
                  originalImageFiles: ['img_r1.jpg'],
                },
              },
            },
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {
            'flight_log.csv': 'filename,altitude\nimg_l1.jpg,120\n',
          },
        },
        projectidFrameMetadataNoSource: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidFrameMetadataNoSource',
            type: 'image-sequence',
            fps: 5,
            originalBasePath: '/home/user/data/frameMetadataNoSource',
            originalImageFiles: [
              'image_0001.jpg',
            ],
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectidFrameMetadataDoubleExt: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidFrameMetadataDoubleExt',
            type: 'image-sequence',
            fps: 5,
            originalBasePath: '/home/user/data/frameMetadataDoubleExt',
            originalImageFiles: [
              'photo.jpg.png',
            ],
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectidFrameMetadataDup: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidFrameMetadataDup',
            type: 'image-sequence',
            fps: 5,
            originalBasePath: '/home/user/data/frameMetadataDupSource',
            // Two files share the basename image_0001.jpg (different subfolders).
            originalImageFiles: [
              'a/image_0001.jpg',
              'b/image_0001.jpg',
              'a/image_0002.jpg',
            ],
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectidMetadataAttachment: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidMetadataAttachment',
            type: 'image-sequence',
            fps: 5,
            originalBasePath: '/home/user/data/frameMetadataSource',
            originalImageFiles: [
              'image_0001.jpg',
              'image_0002.jpg',
              'image_0003.jpg',
            ],
            metadataFile: '/home/user/viamedata/DIVE_Projects/projectidMetadataAttachment/flight_log.csv',
          }),
          'result_whatever.json': JSON.stringify({}),
          'flight_log.csv': [
            'filename,altitude',
            'image_0001.jpg,120',
            '',
          ].join('\n'),
          auxiliary: {},
        },
        projectidMulticamRootDedup: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidMulticamRootDedup',
            type: 'multi',
            fps: 5,
            originalBasePath: '/home/user/data/multicamRootDedup',
            multiCam: {
              defaultDisplay: 'left',
              cameras: {
                left: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/data/multicamRootDedup',
                  originalImageFiles: ['img_l1.jpg', 'img_l2.jpg'],
                },
                right: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/data/multicamRootDedup/right',
                  originalImageFiles: ['img_r1.jpg'],
                },
              },
            },
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectidMulticamSharedRoot: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'projectidMulticamSharedRoot',
            type: 'multi',
            fps: 5,
            originalBasePath: '/home/user/data/multicamSharedRoot',
            multiCam: {
              defaultDisplay: 'left',
              cameras: {
                left: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/data/multicamSharedRoot/left',
                  originalImageFiles: ['img_l1.jpg', 'img_l2.jpg'],
                  metadataFile: 'auxiliary/left/local.csv',
                  metadataOriginalName: 'left-local.csv',
                },
                right: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/data/multicamSharedRoot/right',
                  originalImageFiles: ['img_r1.jpg', 'img_r2.jpg'],
                },
              },
            },
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {
            left: {
              'local.csv': [
                'filename,depth',
                'other.jpg,999',
                '',
              ].join('\n'),
            },
          },
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
        projectid5Bad: {
        // Missing Track JSON File
          'meta.json': '{}',
          auxiliary: {},
        },
        projectid6Delete: {
          'meta.json': '{}',
          'result_1.json': '',
          'result_2.json': '',
          auxiliary: {},
        },
        stereoDataset: {
          'meta.json': JSON.stringify({
            type: 'multi',
            multiCam: {
              defaultDisplay: 'left',
              cameras: {
                left: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/viamedata/DIVE_Projects/stereoDataset/left',
                  originalImageFiles: ['left_20230615_143022.png', 'left_00002.png'],
                },
                right: {
                  type: 'image-sequence',
                  originalBasePath: '/home/user/viamedata/DIVE_Projects/stereoDataset/right',
                  originalImageFiles: ['right_00001.png', 'right_00002.png'],
                },
              },
            },
          }),
          'result_1.json': '',
          auxiliary: {},
          left: {
            'meta.json': JSON.stringify({ originalBasePath: '/home/user/viamedata/DIVE_Projects/stereoDataset/left' }),
            'result_1.json': '',
          },
          right: {
            'meta.json': JSON.stringify({ originalBasePath: '/home/user/viamedata/DIVE_Projects/stereoDataset/right' }),
            'result_1.json': '',
          },
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
              track_attribute1: {
                belongs: 'track',
                datatype: 'text',
                values: ['value1', 'value2', 'value3'],
                name: 'attribute1',
                key: 'track_attribute1',
              },
              detection_attribute1: {
                belongs: 'detection',
                datatype: 'number',
                name: 'attribute1',
                key: 'detection_attribute1',
              },
            },
          }),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },
        projectid5missingMultiCam: {
          'meta.json': JSON.stringify({
            version: 1,
            name: 'missingMulti',
            id: 'projectid5',
            type: 'multi',
            fps: 5,
            originalVideoFile: 'whatever.mp4',
            transcodedVideoFile: 'whatever-transcoded.mp4',
          } as JsonConfig),
          'result_whatever.json': JSON.stringify({}),
          auxiliary: {},
        },

      },
    },
  });
});

describe('native.common', () => {
  it('imports COCO annotations and applies valid producer hierarchy separately', async () => {
    const imported = '/home/user/output/hierarchy.coco.json';
    await fs.writeJSON(imported, cocoWithHierarchy(41, 'shark', 'fish'));

    const result = await common.dataFileImport(settings, 'projectid1', imported);

    expect(result.warnings).toEqual([]);
    expect((await common.loadConfig(settings, 'projectid1', urlMapper)).typeHierarchy)
      .toEqual({ shark: 'fish' });
    expect((await common.loadDetections(settings, 'projectid1')).tracks[41].confidencePairs)
      .toEqual([['shark', 1]]);
  });

  it('warns and skips a conflicting COCO hierarchy without dropping annotations', async () => {
    const imported = '/home/user/output/conflict.coco.json';
    await common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { shark: 'animal' },
    });
    await fs.writeJSON(imported, cocoWithHierarchy(42, 'shark', 'fish'));

    const result = await common.dataFileImport(settings, 'projectid1', imported);

    expect(result.warnings).toEqual([
      'The category hierarchy in the COCO file could not be applied: conflicting parents for '
      + '"shark": "animal" and "fish". Annotations were imported without changing the dataset '
      + 'type hierarchy.',
    ]);
    expect((await common.loadConfig(settings, 'projectid1', urlMapper)).typeHierarchy)
      .toEqual({ shark: 'animal' });
    expect((await common.loadDetections(settings, 'projectid1')).tracks[42]).toBeDefined();
  });

  it('promotes the first multicamera COCO hierarchy and warns on later conflicts', async () => {
    const left = '/home/user/output/left-hierarchy.coco.json';
    const right = '/home/user/output/right-hierarchy.coco.json';
    await fs.writeJSON(left, cocoWithHierarchy(51, 'shark', 'fish'));
    await fs.writeJSON(right, cocoWithHierarchy(52, 'shark', 'animal'));

    const result = await common.ingestDataFiles(
      settings,
      'stereoDataset',
      [],
      { left, right },
    );

    expect(result.meta.typeHierarchy).toEqual({ shark: 'fish' });
    expect(result.warnings).toEqual([
      'The category hierarchy in the COCO file could not be applied: conflicting parents for '
      + '"shark": "fish" and "animal". Annotations were imported without changing the dataset '
      + 'type hierarchy.',
    ]);
  });

  it('preserves warnings from primary COCO files in input order', async () => {
    const first = '/home/user/output/first.coco.json';
    const second = '/home/user/output/second.coco.json';
    await fs.writeFile(first, cocoWithRle(1, 'fish'));
    await fs.writeFile(second, cocoWithRle(2, 'shark'));

    const result = await common.ingestDataFiles(settings, 'projectid1', [first, second]);

    expect(result.processedFiles).toEqual([first, second]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((warning) => warning.includes('segmentation masks'))).toBe(true);
  });

  it('does not let an empty warning list erase earlier primary warnings', async () => {
    const first = '/home/user/output/first.coco.json';
    const empty = '/home/user/output/config.json';
    const third = '/home/user/output/third.csv';
    await fs.writeFile(first, cocoWithRle(1));
    await fs.writeJSON(empty, { confidenceFilters: { default: 0.8 } });
    await fs.writeFile(third, '# metadata,fps: 30,dataset_info: 42');

    const result = await common.ingestDataFiles(settings, 'projectid1', [first, empty, third]);

    expect(result.processedFiles).toEqual([first, empty, third]);
    expect(result.warnings).toEqual([
      'The COCO file included run-length encoded segmentation masks that are not supported. '
        + 'Bounding boxes and other annotation data were imported, but masks were skipped.',
      'Ignored dataset_info entry: expected a JSON object but got number',
    ]);
  });

  it('preserves identical warnings from separate primary files', async () => {
    const first = '/home/user/output/first.coco.json';
    const second = '/home/user/output/second.coco.json';
    const input = cocoWithRle(1);
    await fs.writeFile(first, input);
    await fs.writeFile(second, input);

    const result = await common.ingestDataFiles(settings, 'projectid1', [first, second]);

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toBe(result.warnings[1]);
  });

  it('places primary warnings before multicam warnings', async () => {
    const primary = '/home/user/output/primary.coco.json';
    const multicam = '/home/user/output/left.csv';
    await fs.writeFile(primary, cocoWithRle(1));
    await fs.writeFile(multicam, '# metadata,fps: 30,dataset_info: 42');

    const result = await common.ingestDataFiles(
      settings,
      'stereoDataset',
      [primary],
      { left: multicam },
    );

    expect(result.processedFiles).toEqual([primary, multicam]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('segmentation masks');
    expect(result.warnings[1]).toContain('expected a JSON object but got number');
  });

  it('rejects when a COCO annotation has no bbox and no usable polygon segmentation', async () => {
    const rejectedFile = '/home/user/output/rejected.coco.json';
    await fs.writeJSON(rejectedFile, {
      images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 0 }],
      annotations: [{
        id: 2,
        image_id: 1,
        category_id: 5,
        iscrowd: 1,
        segmentation: { size: [100, 100], counts: 'abc' },
      }],
      categories: [{ id: 5, name: 'fish' }],
    });

    await expect(common.ingestDataFiles(
      settings,
      'projectid1',
      [rejectedFile],
    )).rejects.toThrow('no bbox and no usable polygon segmentation');
  });

  it.each([
    ['malformed', '{broken'],
    ['null', 'null'],
    ['number', '5'],
    ['string', '"annotation"'],
  ])('keeps an earlier annotation write when later %s JSON is invalid', async (kind, contents) => {
    const valid = '/home/user/output/valid-before-malformed.coco.json';
    const malformed = `/home/user/output/${kind}-later.json`;
    const project = common.getProjectDir(settings, 'projectid1');
    await fs.writeFile(valid, cocoWithRle(1));
    await fs.writeFile(malformed, contents);
    const writeFile = vi.spyOn(fs, 'writeFile');

    try {
      await common.ingestDataFiles(
        settings,
        'projectid1',
        [valid, malformed],
      ).catch(() => undefined);

      expect(await fs.pathExists(
        npath.join(project.auxDirAbsPath, `imported_${npath.basename(valid)}`),
      )).toBe(true);
      const annotationWrites = writeFile.mock.calls.filter(([path, data]) => (
        npath.basename(String(path)).startsWith('result_')
        && Object.prototype.hasOwnProperty.call(JSON.parse(String(data)).tracks, '1')
      ));
      expect(annotationWrites).toHaveLength(1);
    } finally {
      writeFile.mockRestore();
    }
  });

  it('getPipelineList lists pipelines', async () => {
    const exists = await fs.pathExists(settings.viamePath);
    expect(exists).toBe(true);
    const pipes = await common.getPipelineList(settings);
    expect(pipes).toBeTruthy();
    expect(pipes.detector.pipes).toHaveLength(4);
    expect(pipes.tracker.pipes).toHaveLength(5);
    expect(pipes.utility.pipes).toHaveLength(4);
    expect(pipes.trained).toBeUndefined();
  });

  it('getValidatedProjectDir loads correct project directory', async () => {
    const basedir = 'DIVE_Projects/projectid1';
    const dir = await common.getValidatedProjectDir(settings, 'projectid1');
    expect(dir.basePath).toBe(npath.join(settings.dataPath, basedir));
    // Fixtures still use legacy meta.json; resolve falls back until a save migrates.
    expect(dir.datasetFileAbsPath).toBe(npath.join(settings.dataPath, basedir, 'meta.json'));
    expect(dir.auxDirAbsPath).toBe(npath.join(settings.dataPath, basedir, 'auxiliary'));
    expect(dir.trackFileAbsPath).toBe(npath.join(settings.dataPath, basedir, 'result_whatever.json'));
  });

  it('saveProjectConfig migrates legacy meta.json to dataset.json', async () => {
    const basedir = npath.join(settings.dataPath, 'DIVE_Projects/projectid1');
    const legacy = npath.join(basedir, 'meta.json');
    const preferred = npath.join(basedir, 'dataset.json');
    expect(await fs.pathExists(legacy)).toBe(true);
    const existing = await fs.readJSON(legacy);
    await common.saveProjectConfig(basedir, existing);
    expect(await fs.pathExists(preferred)).toBe(true);
    expect(await fs.pathExists(legacy)).toBe(false);
    const dir = await common.getValidatedProjectDir(settings, 'projectid1');
    expect(dir.datasetFileAbsPath).toBe(preferred);
  });

  it('saveConfig works on legacy meta.json-only projects and migrates', async () => {
    // Regression: locking dataset.json before it exists caused ENOENT 500s on
    // POST /dataset/:id/meta for projects still on meta.json.
    const basedir = npath.join(settings.dataPath, 'DIVE_Projects/projectid1VideoGood');
    const legacy = npath.join(basedir, 'meta.json');
    const preferred = npath.join(basedir, 'dataset.json');
    expect(await fs.pathExists(legacy)).toBe(true);
    expect(await fs.pathExists(preferred)).toBe(false);

    await common.saveConfig(settings, 'projectid1VideoGood', {
      imageEnhancements: {
        brightness: 1.2, contrast: 1, saturation: 1, sharpen: 0,
      },
    });

    expect(await fs.pathExists(preferred)).toBe(true);
    expect(await fs.pathExists(legacy)).toBe(false);
    const saved = await fs.readJSON(preferred);
    expect(saved.imageEnhancements.brightness).toBe(1.2);
  });
  it('getValidatedProjectDir loads initial track.json', async () => {
    const basedir = 'DIVE_Projects/projectid4Bad';
    const dir = await common.getValidatedProjectDir(settings, 'projectid4Bad');
    expect(dir.trackFileAbsPath).toBe(npath.join(settings.dataPath, basedir, 'result_1.json'));
  });

  it('getValidatedProjectDir fails to load project directory for invalid contents', async () => {
    await expect(common.getValidatedProjectDir(settings, 'projectid2Bad'))
      .rejects.toThrow('missing track json file');
    await expect(common.getValidatedProjectDir(settings, 'projectid3Bad'))
      .rejects.toThrow('missing dataset json file');
  });

  it('loadJsonConfig loads configuration from file', async () => {
    const data = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(data.id).toBe('projectid1');
    expect(data.imageData.map(({ filename }) => filename)).toEqual([
      'foo_20230615_143022.png', 'bar.png',
    ]);
    expect(data.imageData[0].timestamp).toBe(1686839422);
    expect(data.imageData[1].timestamp).toBeUndefined();
  });

  it('saveConfig sets, clears, and atomically rejects a type hierarchy', async () => {
    const legacyProject = common.getProjectDir(settings, 'projectid1');
    await common.saveProjectConfig(
      legacyProject.basePath,
      await fs.readJSON(legacyProject.datasetFileAbsPath),
    );
    await common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { shark: 'fish' },
    });
    let meta = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(meta.typeHierarchy).toEqual({ shark: 'fish' });

    const project = common.getProjectDir(settings, 'projectid1');
    const beforeInvalid = await fs.readFile(project.datasetFileAbsPath, 'utf8');
    await expect(common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { fish: 'fish' },
      confidenceFilters: { default: 0.9 },
    })).rejects.toThrow(
      'Type hierarchy is invalid: self edge "fish -> fish". No configuration was changed.',
    );
    expect(await fs.readFile(project.datasetFileAbsPath, 'utf8')).toBe(beforeInvalid);

    await common.saveConfig(settings, 'projectid1', { typeHierarchy: null });
    meta = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(meta.typeHierarchy).toBeUndefined();
  });

  it('an unrelated direct save preserves invalid hierarchy storage until repaired', async () => {
    let project = common.getProjectDir(settings, 'projectid1');
    const raw = await fs.readJSON(project.datasetFileAbsPath);
    raw.typeHierarchy = ['corrupt'];
    await common.saveProjectConfig(project.basePath, raw);
    project = common.getProjectDir(settings, 'projectid1');

    await common.saveConfig(settings, 'projectid1', {
      confidenceFilters: { default: 0.7 },
    });
    let saved = await fs.readJSON(common.getProjectDir(settings, 'projectid1').datasetFileAbsPath);
    expect(saved.typeHierarchy).toEqual(['corrupt']);

    await common.saveConfig(settings, 'projectid1', { typeHierarchy: {} });
    saved = await fs.readJSON(common.getProjectDir(settings, 'projectid1').datasetFileAbsPath);
    expect(saved.typeHierarchy).toBeUndefined();
    await common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { tuna: 'fish' },
    });
    saved = await fs.readJSON(common.getProjectDir(settings, 'projectid1').datasetFileAbsPath);
    expect(saved.typeHierarchy).toEqual({ tuna: 'fish' });
  });

  it('imports overwrite, additive, and explicit-empty hierarchy instructions', async () => {
    const overwrite = '/home/user/output/hierarchy-overwrite.json';
    const additive = '/home/user/output/hierarchy-additive.json';
    const empty = '/home/user/output/hierarchy-empty.json';
    const cleared = '/home/user/output/hierarchy-null.json';
    await fs.writeJSON(overwrite, { typeHierarchy: { shark: 'fish' } });
    await fs.writeJSON(additive, { typeHierarchy: { tuna: 'fish' } });
    await fs.writeJSON(empty, { typeHierarchy: {} });
    await fs.writeJSON(cleared, { typeHierarchy: null });

    await common.dataFileImport(settings, 'projectid1', overwrite);
    await common.dataFileImport(settings, 'projectid1', additive, true);
    let meta = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(meta.typeHierarchy).toEqual({ shark: 'fish', tuna: 'fish' });

    await common.dataFileImport(settings, 'projectid1', empty, true);
    meta = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(meta.typeHierarchy).toEqual({ shark: 'fish', tuna: 'fish' });
    await common.dataFileImport(settings, 'projectid1', cleared, true);
    meta = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(meta.typeHierarchy).toBeUndefined();

    await common.dataFileImport(settings, 'projectid1', overwrite);
    await common.dataFileImport(settings, 'projectid1', empty);
    meta = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(meta.typeHierarchy).toBeUndefined();
  });

  it('rejects additive hierarchy conflicts without writes and allows corrected retry', async () => {
    const imported = '/home/user/output/hierarchy-conflict.json';
    const legacyProject = common.getProjectDir(settings, 'projectid1');
    await common.saveProjectConfig(
      legacyProject.basePath,
      await fs.readJSON(legacyProject.datasetFileAbsPath),
    );
    await common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { shark: 'fish' },
      confidenceFilters: { default: 0.2 },
    });
    await fs.writeJSON(imported, {
      typeHierarchy: { shark: 'animal' },
      confidenceFilters: { default: 0.9 },
    });
    const project = await common.getValidatedProjectDir(settings, 'projectid1');
    const before = await fs.readFile(project.datasetFileAbsPath, 'utf8');

    await expect(common.dataFileImport(
      settings,
      'projectid1',
      imported,
      true,
    )).rejects.toThrow(
      'Type hierarchy is invalid: conflicting parents for "shark": "fish" and "animal". '
      + 'No configuration was changed.',
    );
    expect(await fs.readFile(project.datasetFileAbsPath, 'utf8')).toBe(before);
    expect(await fs.pathExists(npath.join(project.auxDirAbsPath, 'imported_hierarchy-conflict.json')))
      .toBe(false);

    await fs.writeJSON(imported, { typeHierarchy: { tuna: 'fish' } });
    await common.dataFileImport(settings, 'projectid1', imported, true);
    const saved = await common.loadConfig(settings, 'projectid1', urlMapper);
    expect(saved.typeHierarchy).toEqual({ shark: 'fish', tuna: 'fish' });
  });

  it('preflights ordered hierarchy config batches and cleans every auxiliary copy on failure', async () => {
    const annotation = '/home/user/output/annotation-before-config.json';
    const first = '/home/user/output/hierarchy-first.json';
    const second = '/home/user/output/hierarchy-second.json';
    await fs.writeJSON(annotation, { 0: { trackId: 0 } });
    await fs.writeJSON(first, {
      typeHierarchy: { shark: 'fish' },
      datasetInfo: { first: true, replaced: 'first' },
    });
    await fs.writeJSON(second, { typeHierarchy: { fish: 'shark' } });
    const project = await common.getValidatedProjectDir(settings, 'projectid1');
    const before = await fs.readFile(project.datasetFileAbsPath, 'utf8');
    const annotationsBefore = await fs.readFile(project.trackFileAbsPath, 'utf8');

    await expect(common.ingestDataFiles(
      settings,
      'projectid1',
      [annotation, first, second],
      undefined,
      undefined,
      true,
    )).rejects.toThrow(
      'Type hierarchy is invalid: cycle fish -> shark -> fish. No configuration was changed.',
    );
    expect(await fs.readFile(project.datasetFileAbsPath, 'utf8')).toBe(before);
    expect(await fs.readFile(project.trackFileAbsPath, 'utf8')).toBe(annotationsBefore);
    expect(await fs.pathExists(npath.join(project.auxDirAbsPath, 'imported_hierarchy-first.json')))
      .toBe(false);
    expect(await fs.pathExists(npath.join(project.auxDirAbsPath, 'imported_hierarchy-second.json')))
      .toBe(false);

    await fs.writeJSON(second, {
      typeHierarchy: { tuna: 'fish' },
      datasetInfo: { second: true, replaced: 'second' },
    });
    const result = await common.ingestDataFiles(
      settings,
      'projectid1',
      [first, second],
      undefined,
      undefined,
      true,
    );
    expect(result.meta.typeHierarchy).toEqual({ shark: 'fish', tuna: 'fish' });
    expect(result.meta.datasetInfo).toEqual({
      first: true,
      second: true,
      replaced: 'second',
    });

    const overwriteResult = await common.ingestDataFiles(
      settings,
      'projectid1',
      [first, second],
    );
    expect(overwriteResult.meta.typeHierarchy).toEqual({ tuna: 'fish' });
    expect(overwriteResult.meta.datasetInfo).toEqual({ second: true, replaced: 'second' });
  });

  it('parses each config once and executes the exact ordered hierarchy candidate', async () => {
    const first = '/home/user/output/parse-once-first.json';
    const second = '/home/user/output/parse-once-second.json';
    const legacyProject = common.getProjectDir(settings, 'projectid1');
    await common.saveProjectConfig(
      legacyProject.basePath,
      await fs.readJSON(legacyProject.datasetFileAbsPath),
    );
    await common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { shark: 'fish' },
    });
    await fs.writeJSON(first, {
      typeHierarchy: { tuna: 'fish' },
      datasetInfo: { sequence: 'first' },
    });
    await fs.writeJSON(second, {
      typeHierarchy: { mako: 'shark' },
      datasetInfo: { sequence: 'second' },
    });
    const readFile = vi.spyOn(fs, 'readFile');

    try {
      const result = await common.ingestDataFiles(
        settings,
        'projectid1',
        [first, second],
        undefined,
        undefined,
        true,
      );

      expect(result.meta.typeHierarchy).toEqual({
        mako: 'shark',
        shark: 'fish',
        tuna: 'fish',
      });
      expect(result.meta.datasetInfo).toEqual({ sequence: 'second' });
      expect(readFile.mock.calls.filter(([path]) => path === first)).toHaveLength(1);
      expect(readFile.mock.calls.filter(([path]) => path === second)).toHaveLength(1);
    } finally {
      readFile.mockRestore();
    }
  });

  it('surfaces the exact hierarchy error through the desktop public import boundary', async () => {
    const imported = '/home/user/output/public-import-conflict.json';
    const expected = 'Type hierarchy is invalid: conflicting parents for "shark": "fish" and '
      + '"animal". No configuration was changed.';
    const legacyProject = common.getProjectDir(settings, 'projectid1');
    await common.saveProjectConfig(
      legacyProject.basePath,
      await fs.readJSON(legacyProject.datasetFileAbsPath),
    );
    await common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { shark: 'fish' },
    });
    await fs.writeJSON(imported, { typeHierarchy: { shark: 'animal' } });
    let surfacedError: unknown;

    try {
      await common.dataFileImport(settings, 'projectid1', imported, true);
    } catch (error) {
      surfacedError = error;
    }

    expect(surfacedError).toBeInstanceOf(Error);
    expect((surfacedError as Error).message).toBe(expected);
    expect(getResponseError(surfacedError)).toBe(expected);
  });

  it('exports only a valid non-empty type hierarchy and writes no invalid export', async () => {
    const output = '/home/user/output/exported-config.json';
    const legacyProject = common.getProjectDir(settings, 'projectid1');
    await common.saveProjectConfig(
      legacyProject.basePath,
      await fs.readJSON(legacyProject.datasetFileAbsPath),
    );
    await common.saveConfig(settings, 'projectid1', {
      typeHierarchy: { shark: 'fish' },
    });
    await common.exportConfiguration(settings, { id: 'projectid1', path: output });
    expect((await fs.readJSON(output)).typeHierarchy).toEqual({ shark: 'fish' });

    await common.saveConfig(settings, 'projectid1', { typeHierarchy: null });
    await common.exportConfiguration(settings, { id: 'projectid1', path: output });
    expect((await fs.readJSON(output)).typeHierarchy).toBeUndefined();

    const project = common.getProjectDir(settings, 'projectid1');
    const raw = await fs.readJSON(project.datasetFileAbsPath);
    raw.typeHierarchy = { fish: 'fish' };
    await fs.writeJSON(project.datasetFileAbsPath, raw);
    await fs.remove(output);
    await expect(common.exportConfiguration(
      settings,
      { id: 'projectid1', path: output },
    )).rejects.toThrow(
      'Type hierarchy is invalid: self edge "fish -> fish". '
      + 'No configuration file was exported.',
    );
    expect(await fs.pathExists(output)).toBe(false);
  });

  it('loadJsonConfig parses per-camera frame timestamps for multicam datasets', async () => {
    const data = await common.loadConfig(settings, 'stereoDataset', urlMapper);
    expect(data.multiCamMedia).not.toBeNull();
    const { cameras } = data.multiCamMedia!;
    expect(cameras.left.imageData.map(({ timestamp }) => timestamp)).toEqual([
      1686839422, undefined,
    ]);
    expect(cameras.right.imageData.map(({ timestamp }) => timestamp)).toEqual([
      undefined, undefined,
    ]);
  });

  it('loadJsonConfig prefers transcoded media when it exists', async () => {
    const data = await common.loadConfig(settings, 'projectid1VideoGood', urlMapper);
    const videoPath = npath.join(settings.dataPath, 'DIVE_Projects', 'projectid1VideoGood', 'whatever-transcoded.mp4');
    expect(data.videoUrl).toBe(`http://localhost:8888/api/media?path=${videoPath}`);
  });

  it('loadJsonConfig type multi without multiCam', async () => {
    await expect(common.loadConfig(settings, 'projectid5missingMultiCam', urlMapper))
      .rejects.toThrow('Dataset: missingMulti is of type multiCam or stereo but contains no multiCam data');
  });

  it('createWorkingDirectory creates pipeline run directories', async () => {
    await expect(createWorkingDirectory(settings, [], 'whatever.pipe'))
      .rejects.toThrow('At least 1 jsonConfig item');
    const jsonConfig: JsonConfig = {
      version: 1,
      type: 'image-sequence',
      fps: 100,
      originalFps: 0,
      name: 'myproject1_name',
      createdAt: (new Date()).toString(),
      originalBasePath: '/foo/bar/baz',
      id: 'myproject1_name_tktfgyv2g9',
      originalImageFiles: [],
      transcodedImageFiles: [],
      originalVideoFile: '',
      transcodedVideoFile: '',
      multiCam: null,
      subType: null,
    };
    const result = await createWorkingDirectory(settings, [jsonConfig], 'mypipeline.pipe');
    const stat = fs.statSync(result);
    const contents = fs.readdirSync(result);
    expect(stat.isDirectory()).toBe(true);
    expect(contents).toEqual([]);
    // Every interpolated component is path-sanitized, pipeline included:
    // whitespace, dots and slashes collapse to underscores.
    expect(result).toMatch(/DIVE_Jobs\/myproject1_name_tktfgyv2g9_mypipeline_pipe_/);

    // Pipeline display names carry spaces ("utility align cameras 3 cam"),
    // which used to land verbatim in the job folder name.
    const spaced = await createWorkingDirectory(settings, [jsonConfig], 'utility align cameras 3 cam');
    expect(spaced).toMatch(
      /DIVE_Jobs\/myproject1_name_tktfgyv2g9_utility_align_cameras_3_cam_/,
    );
    expect(spaced).not.toMatch(/ /);
  });

  it('beginMediaImport image sequence success', async () => {
    const payload = await common.beginMediaImport('/home/user/data/imageSuccess');
    expect(payload.jsonConfig.name).toBe('imageSuccess');
    expect(payload.jsonConfig.originalImageFiles).toEqual(['bar.png', 'foo.png']);
    expect(payload.jsonConfig.originalVideoFile).toBe('');
    expect(payload.jsonConfig.originalBasePath).toBe('/home/user/data/imageSuccess');
  });

  it('offers one reserved metadata attachment on the media import response', async () => {
    const payload = await common.beginMediaImport('/home/user/data/frameMetadataSource');

    // The dialog binds metadataFileAbsPath, so a discovered attachment must land there rather
    // than on jsonConfig, where the user could neither see nor clear it.
    expect(payload.metadataFileAbsPath)
      .toBe('/home/user/data/frameMetadataSource/frame-metadata.txt');
    expect(payload.jsonConfig.metadataFile).toBeUndefined();
  });

  it('offers an exported folder\'s archive attachment on the media import response', async () => {
    const payload = await common.beginMediaImport('/home/user/data/archiveDataset');

    expect(payload.metadataFileAbsPath)
      .toBe('/home/user/data/archiveDataset/metadata/flight_log.csv');
  });

  it('stores the explicitly chosen attachment under its own name', async () => {
    // The folder holds frame-metadata.txt, but the user picked flight_log.json in the import
    // dialog. Storing it under the discovered name would both mislabel it in the panel and,
    // because readability is decided by name, feed a JSON body to the CSV parser.
    const payload = await common.beginMediaImport('/home/user/data/frameMetadataSource');
    payload.metadataFileAbsPath = '/home/user/data/explicitMetadata/flight_log.json';

    const { meta } = await common.finalizeMediaImport(settings, payload);
    const projectDir = npath.join(settings.dataPath, ProjectsFolderName, meta.id);
    expect(meta.metadataOriginalName).toBe('flight_log.json');
    expect(meta.metadataFile).toBe(npath.join(projectDir, 'auxiliary', 'flight_log.json'));

    const loaded = await common.loadFrameMetadata(settings, meta.id);
    expect(loaded.shared?.name).toBe('flight_log.json');
    expect(loaded.shared?.text).toBeUndefined();
  });

  it('refuses a metadata attachment the platforms do not accept', async () => {
    const payload = await common.beginMediaImport('/home/user/data/imageSuccess');
    payload.metadataFileAbsPath = '/home/user/data/imageSuccess/foo.png';

    await expect(common.finalizeMediaImport(settings, payload))
      .rejects.toThrow('Metadata attachment must be a JSON, TXT, or CSV file');
  });

  it('stores shared and camera-local multicam attachments under auxiliary', async () => {
    const shared = '/home/user/data/videoMetadataSource/frame_metadata.csv';
    const local = '/home/user/data/frameMetadataSource/frame-metadata.txt';
    const payload = await beginMultiCamImport({
      datasetName: 'metadata_multicam',
      defaultDisplay: 'left',
      sourceList: {
        left: {
          sourcePath: '/home/user/data/imageSuccess',
          trackFile: '',
          metadataFile: local,
        },
        right: {
          sourcePath: '/home/user/data/imageSuccess',
          trackFile: '',
        },
      },
      metadataFile: shared,
      type: 'image-sequence',
    });

    expect(payload.metadataFileAbsPath).toBe(shared);
    expect(payload.jsonConfig.metadataFile).toBeUndefined();

    const { meta } = await common.finalizeMediaImport(settings, payload);
    const projectDir = npath.join(settings.dataPath, ProjectsFolderName, meta.id);
    expect(meta.metadataFile).toBe(npath.join(projectDir, 'auxiliary', 'frame_metadata.csv'));
    expect(meta.multiCam?.cameras.left.metadataFile)
      .toBe(npath.join(projectDir, 'auxiliary', 'left', 'frame-metadata.txt'));
    expect(await fs.pathExists(meta.metadataFile as string)).toBe(true);
    expect(await fs.pathExists(meta.multiCam?.cameras.left.metadataFile as string)).toBe(true);

    const leftMeta = await fs.readJSON(npath.join(projectDir, 'left', 'dataset.json'));
    expect(leftMeta.metadataFile).toBe(meta.multiCam?.cameras.left.metadataFile);
    expect(leftMeta.metadataOriginalName).toBe('frame-metadata.txt');
    const rightMeta = await fs.readJSON(npath.join(projectDir, 'right', 'dataset.json'));
    expect(rightMeta.metadataFile).toBeUndefined();
    expect(rightMeta.metadataOriginalName).toBeUndefined();
  });

  it('promotes the first camera COCO hierarchy and reports a later conflict', async () => {
    const leftTrackFile = '/home/user/output/finalize-left.coco.json';
    const rightTrackFile = '/home/user/output/finalize-right.coco.json';
    await fs.writeJSON(leftTrackFile, cocoWithHierarchy(61, 'shark', 'fish'));
    await fs.writeJSON(rightTrackFile, cocoWithHierarchy(62, 'shark', 'animal'));
    const payload = await beginMultiCamImport({
      datasetName: 'hierarchy_multicam',
      defaultDisplay: 'left',
      sourceList: {
        left: {
          sourcePath: '/home/user/data/imageSuccess',
          trackFile: leftTrackFile,
        },
        right: {
          sourcePath: '/home/user/data/imageSuccess',
          trackFile: rightTrackFile,
        },
      },
      type: 'image-sequence',
    });

    const result = await common.finalizeMediaImport(settings, payload);

    expect(result.meta.typeHierarchy).toEqual({ shark: 'fish' });
    expect(result.importWarnings).toContain(
      'Camera "right" type hierarchy was skipped: conflicting parents for "shark": "fish" '
      + 'and "animal"',
    );
    const project = common.getProjectDir(settings, result.meta.id);
    const leftMeta = await fs.readJSON(npath.join(project.basePath, 'left', 'dataset.json'));
    const rightMeta = await fs.readJSON(npath.join(project.basePath, 'right', 'dataset.json'));
    expect(leftMeta.typeHierarchy).toBeUndefined();
    expect(rightMeta.typeHierarchy).toBeUndefined();
  });

  it('promotes hierarchies in stored camera order and still imports unlisted cameras', async () => {
    const leftTrackFile = '/home/user/output/ordered-left.coco.json';
    const rightTrackFile = '/home/user/output/ordered-right.coco.json';
    await fs.writeJSON(leftTrackFile, cocoWithHierarchy(63, 'shark', 'fish'));
    await fs.writeJSON(rightTrackFile, cocoWithHierarchy(64, 'shark', 'animal'));
    const payload = await beginMultiCamImport({
      datasetName: 'ordered_hierarchy_multicam',
      defaultDisplay: 'left',
      sourceList: {
        left: {
          sourcePath: '/home/user/data/imageSuccess',
          trackFile: leftTrackFile,
        },
        right: {
          sourcePath: '/home/user/data/imageSuccess',
          trackFile: rightTrackFile,
        },
      },
      type: 'image-sequence',
    });
    // Simulate a legacy/partial stored order: unknown names are ignored and cameras omitted
    // from the list are appended after the explicitly ordered cameras.
    if (payload.jsonConfig.multiCam) {
      payload.jsonConfig.multiCam.cameraOrder = ['missing', 'right'];
    }

    const result = await common.finalizeMediaImport(settings, payload);

    expect(result.meta.typeHierarchy).toEqual({ shark: 'animal' });
    expect(result.importWarnings).toContain(
      'Camera "left" type hierarchy was skipped: conflicting parents for "shark": "animal" '
      + 'and "fish"',
    );
    const project = common.getProjectDir(settings, result.meta.id);
    expect(await fs.pathExists(npath.join(project.basePath, 'right', 'dataset.json'))).toBe(true);
    expect(await fs.pathExists(npath.join(project.basePath, 'left', 'dataset.json'))).toBe(true);
  });

  it('warns instead of refusing when a folder holds two reserved metadata attachments', async () => {
    // The dialog's "Metadata File (Optional)" picker is the only place the user can settle
    // this, and it opens only once beginMediaImport returns, so the import must survive.
    const payload = await common.beginMediaImport('/home/user/data/fmGateMultipleMetadata');

    expect(payload.metadataFileAbsPath).toBeUndefined();
    expect(payload.importWarnings).toEqual([
      'More than one metadata file was found in /home/user/data/fmGateMultipleMetadata.'
      + ' Keep one and try again.',
    ]);
  });

  it('leaves a plain folder\'s own metadata/ subdirectory alone', async () => {
    // Only exported dataset folders carry the archive contract. Applying it here would make
    // any dataset with a metadata/ directory of its own impossible to import.
    const payload = await common.beginMediaImport('/home/user/data/metadataSubdirectory');

    expect(payload.metadataFileAbsPath).toBeUndefined();
    expect(payload.importWarnings).toBeUndefined();
  });

  it('beginMediaImport image lists success', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    expect(payload.jsonConfig.originalBasePath).toBe('');
    expect(payload.jsonConfig.originalImageFiles).toEqual([
      '/home/user/data/imageLists/success/image3.png',
      '/home/user/data/imageLists/success/image2.png',
      '/home/user/data/imageLists/success/image4.png',
      '/home/user/data/imageLists/success/image1.png',
    ]);
    expect(payload.jsonConfig.name).toBe('success');
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    expect(final.originalImageFiles.length).toBe(4);
    expect(final.name).toBe('success');
    expect(final.imageListPath).toBe('/home/user/data/imageLists/success/image_list.txt');
    expect(final.originalBasePath).toBe('');
  });

  it('beginMediaImport image lists glob success', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/successGlob/image_list.txt',
    );
    expect(payload.jsonConfig.originalBasePath).toBe('');
    payload.globPattern = '2018*';
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    const expectedImageFiles = [
      '/home/user/data/imageLists/successGlob/2018-image2.png',
      '/home/user/data/imageLists/successGlob/nested/2018-image1.png',
    ];
    expect(final.originalImageFiles).toEqual(expectedImageFiles);
    expect(final.originalBasePath).toBe('');
    const reload = await common.loadConfig(settings, final.id, urlMapper);
    expect(reload.originalImageFiles).toEqual(expectedImageFiles);
    expect(reload.imageListPath).toBe('/home/user/data/imageLists/successGlob/image_list.txt');
  });

  it('beginMediaImport image list fail empty relative', async () => {
    await expect(common.beginMediaImport(
      '/home/user/data/imageLists/failEmptyRelative/image_list.txt',
    )).rejects.toThrowError('Image from image list /home/user/data/imageLists/failEmptyRelative/image1.png was not found');
  });

  it('beginMediaImport image list fail empty absolute', async () => {
    await expect(common.beginMediaImport(
      '/home/user/data/imageLists/failEmptyAbsolute/name-not-important.txt',
    )).rejects.toThrowError('Image from image list /bad/path/image2.png was not found');
  });

  it('beginMediaImport image list fail empty text file', async () => {
    await expect(common.beginMediaImport(
      '/home/user/data/imageLists/failEmptyList/image_list.txt',
    )).rejects.toThrowError('No images in input image list');
  });

  it('beginMediaImport image list fail invalid mime', async () => {
    await expect(common.beginMediaImport(
      '/home/user/data/imageLists/failInvalidImageMIME/image_list.txt',
    )).rejects.toThrowError('Found non-image type data in image list file');
  });

  it('dataFileImport', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    const annotations = await common.loadDetections(settings, final.id);
    expect(Object.keys(annotations.tracks)).toHaveLength(0);

    await common.dataFileImport(settings, final.id, '/home/user/data/annotationImport/dive.json');
    const annotations1 = await common.loadDetections(settings, final.id);
    expect(Object.keys(annotations1.tracks)).toHaveLength(1);

    await common.dataFileImport(settings, final.id, '/home/user/data/annotationImport/viame.csv');
    const annotations2 = await common.loadDetections(settings, final.id);
    console.log(annotations2);
    expect(Object.keys(annotations2.tracks)).toHaveLength(0);
    const meta = await common.loadConfig(settings, final.id, urlMapper);
    expect(meta.fps).toBe(32);

    await common.dataFileImport(settings, final.id, '/home/user/data/annotationImport/foreign.meta.json');
    const meta2 = await common.loadConfig(settings, final.id, urlMapper);
    expect(meta2.confidenceFilters).toStrictEqual({ default: 0.8 });
    expect(meta2.type).toBe('image-sequence'); // Ensure meta import cannot change immutable fields.
  });

  it('dataFileImport resolves datasetInfo from DIVE configuration imports', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    const existingDatasetInfo = { cruise: '2403', sta_lat: '26.8195', year: '2024' };
    const importedDatasetInfo = { year: '2025', gfishsite_id: '2024TXN012' };

    await common.saveConfig(settings, final.id, { datasetInfo: existingDatasetInfo });
    await common.dataFileImport(
      settings,
      final.id,
      '/home/user/data/annotationImport/dataset-info.config.json',
    );
    const overwriteMeta = await common.loadConfig(settings, final.id, urlMapper);
    expect(overwriteMeta.datasetInfo).toStrictEqual(importedDatasetInfo);

    await common.saveConfig(settings, final.id, { datasetInfo: existingDatasetInfo });
    await common.dataFileImport(
      settings,
      final.id,
      '/home/user/data/annotationImport/dataset-info.config.json',
      true,
    );
    const additiveMeta = await common.loadConfig(settings, final.id, urlMapper);
    expect(additiveMeta.datasetInfo).toStrictEqual({
      ...existingDatasetInfo,
      ...importedDatasetInfo,
    });
  });

  it('dataFileImport config targeted at a multicam camera updates the base metadata', async () => {
    const basePayload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const baseRes = await common.finalizeMediaImport(settings, basePayload);
    const baseId = baseRes.meta.id;
    const cameraPayload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const cameraRes = await common.finalizeMediaImport(settings, cameraPayload);
    // Relocate the second project to be a camera subfolder of the first,
    // forming the `<base>/<camera>` composite layout of a multicam dataset.
    const projects = npath.join(settings.dataPath, ProjectsFolderName);
    await fs.move(
      npath.join(projects, cameraRes.meta.id),
      npath.join(projects, baseId, 'left'),
    );

    // Seed parent registration so a config import must not clobber it.
    const baseDir = common.getProjectDir(settings, baseId);
    const seededBase = await common.loadJsonConfig(baseDir.datasetFileAbsPath);
    seededBase.cameraHomographies = {
      'left::right': {
        AtoB: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        BtoA: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      },
    };
    seededBase.cameraCorrespondences = {
      'left::right': [{ id: 1, a: [0, 0], b: [1, 1] }],
    };
    seededBase.cameraTransformTypes = { 'left::right': 'similarity' };
    seededBase.cameraRegistrationSource = { model: 'seeded' };
    seededBase.typeHierarchy = { shark: 'fish' };
    await fs.writeJSON(baseDir.datasetFileAbsPath, seededBase);
    const cameraDir = common.getProjectDir(settings, `${baseId}/left`);
    const seededCamera = await common.loadJsonConfig(cameraDir.datasetFileAbsPath);
    seededCamera.typeHierarchy = { whale: 'mammal' };
    await fs.writeJSON(cameraDir.datasetFileAbsPath, seededCamera);

    await common.dataFileImport(
      settings,
      `${baseId}/left`,
      '/home/user/data/annotationImport/foreign.meta.withExtras.json',
    );
    // The camera's own metadata receives the full imported config,
    const cameraMeta = await common.loadConfig(settings, `${baseId}/left`, urlMapper);
    expect(cameraMeta.confidenceFilters).toStrictEqual({ default: 0.8 });
    expect(cameraMeta.imageEnhancements).toStrictEqual({ brightness: 1.1 });
    // Shared keys land on the base metadata the viewer reads,
    const baseMeta = await common.loadConfig(settings, baseId, urlMapper);
    expect(baseMeta.confidenceFilters).toStrictEqual({ default: 0.8 });
    expect(baseMeta.customTypeStyling).toStrictEqual({ fish: { color: 'green' } });
    // but per-camera enhancements and registration must stay untouched on the parent.
    expect(baseMeta.imageEnhancements).toBeUndefined();
    expect(baseMeta.cameraHomographies).toStrictEqual(seededBase.cameraHomographies);
    expect(baseMeta.cameraCorrespondences).toStrictEqual(seededBase.cameraCorrespondences);
    expect(baseMeta.cameraTransformTypes).toStrictEqual(seededBase.cameraTransformTypes);
    expect(baseMeta.cameraRegistrationSource).toStrictEqual(seededBase.cameraRegistrationSource);

    const hierarchyImport = '/home/user/output/multicam-hierarchy.json';
    await fs.writeJSON(hierarchyImport, { typeHierarchy: { shark: 'animal' } });
    const parentBeforeConflict = await fs.readFile(baseDir.datasetFileAbsPath, 'utf8');
    const cameraBeforeConflict = await fs.readFile(cameraDir.datasetFileAbsPath, 'utf8');
    await expect(common.dataFileImport(
      settings,
      `${baseId}/left`,
      hierarchyImport,
      true,
    )).rejects.toThrow(
      'Type hierarchy is invalid: conflicting parents for "shark": "fish" and "animal". '
      + 'No configuration was changed.',
    );
    expect(await fs.readFile(baseDir.datasetFileAbsPath, 'utf8')).toBe(parentBeforeConflict);
    expect(await fs.readFile(cameraDir.datasetFileAbsPath, 'utf8')).toBe(cameraBeforeConflict);

    await fs.writeJSON(hierarchyImport, { typeHierarchy: { tuna: 'fish' } });
    await common.dataFileImport(settings, `${baseId}/left`, hierarchyImport, true);
    const resolvedHierarchy = { shark: 'fish', tuna: 'fish' };
    expect((await common.loadConfig(settings, baseId, urlMapper)).typeHierarchy)
      .toEqual(resolvedHierarchy);
    expect((await common.loadConfig(settings, `${baseId}/left`, urlMapper)).typeHierarchy)
      .toEqual(resolvedHierarchy);
  });

  it('saveConfig writes per-camera registration files (pairs + points) and reloads them', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    // Directional key: rgb is left, ir is right.
    const cameraHomographies = {
      'rgb::ir': {
        AtoB: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
        BtoA: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
      },
    };
    const cameraCorrespondences: CameraCorrespondences = {
      'rgb::ir': [
        { id: 1, a: [10, 20], b: [12, 22] },
        { id: 2, a: [30, 40], b: [33, 44] },
      ],
    };

    await common.saveConfig(settings, final.id, { cameraHomographies, cameraCorrespondences });

    // Persisted as a standalone per-camera file, named for the mapping it
    // carries (ir warps onto rgb): pairs labeled left/right, with points
    // laid out as leftX leftY rightX rightY. Never a single all-pairs file.
    const projectDir = npath.join(settings.dataPath, 'DIVE_Projects', final.id);
    const registrationPath = npath.join(projectDir, 'ir_to_rgb_registration.json');
    expect(await fs.pathExists(registrationPath)).toBe(true);
    const registration = await fs.readJSON(registrationPath);
    // Self-identifies so parent-folder discovery recognizes it.
    expect(registration.type).toBe('dive-camera-registration');
    expect(registration.pairs).toStrictEqual([
      {
        left: 'rgb',
        right: 'ir',
        points: [[10, 20, 12, 22], [30, 40, 33, 44]],
        leftToRight: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
        rightToLeft: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
        // No explicit choice was saved, so persistence fills the default model.
        transformType: 'similarity',
      },
    ]);

    // Not embedded in dataset.json.
    const datasetPath = npath.join(projectDir, 'dataset.json');
    expect(await fs.pathExists(datasetPath)).toBe(true);
    expect(await fs.pathExists(npath.join(projectDir, 'meta.json'))).toBe(false);
    const meta = await fs.readJSON(datasetPath);
    expect(meta.cameraHomographies).toBeUndefined();
    expect(meta.cameraCorrespondences).toBeUndefined();
    expect(meta.cameraTransformTypes).toBeUndefined();

    // Rehydrated on load back into the in-app shapes.
    const reloaded = await common.loadConfig(settings, final.id, urlMapper);
    expect(reloaded.cameraHomographies).toStrictEqual(cameraHomographies);
    expect(reloaded.cameraCorrespondences).toStrictEqual(cameraCorrespondences);
    expect(reloaded.cameraTransformTypes).toStrictEqual({ 'rgb::ir': 'similarity' });
  });

  it('saveConfig persists a non-default transformType per pair and reloads it', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    const cameraHomographies = {
      'rgb::ir': {
        AtoB: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
        BtoA: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
      },
    };
    const cameraTransformTypes = { 'rgb::ir': 'rigid' as const };

    await common.saveConfig(settings, final.id, { cameraHomographies, cameraTransformTypes });

    const projectDir = npath.join(settings.dataPath, 'DIVE_Projects', final.id);
    const registration = await fs.readJSON(npath.join(projectDir, 'ir_to_rgb_registration.json'));
    expect(registration.pairs[0].transformType).toBe('rigid');

    const reloaded = await common.loadConfig(settings, final.id, urlMapper);
    expect(reloaded.cameraTransformTypes).toStrictEqual(cameraTransformTypes);
  });

  describe('findParentFolderTransformFiles', () => {
    it('gives a file named calibration.json no special priority (self-identified only)', async () => {
      const found = await common.findParentFolderTransformFiles('/home/user/transformDiscovery/exactName');
      expect(found).toStrictEqual([
        npath.join('/home/user/transformDiscovery/exactName', 'aaa-stamped.json'),
        npath.join('/home/user/transformDiscovery/exactName', 'calibration.json'),
      ]);
    });

    it('finds marked files under any name, skipping unmarked and broken JSON', async () => {
      const found = await common.findParentFolderTransformFiles('/home/user/transformDiscovery/otherName');
      expect(found).toStrictEqual([
        npath.join('/home/user/transformDiscovery/otherName', 'z-transforms.json'),
      ]);
    });

    it('finds per-camera *_registration.json files, alphabetically', async () => {
      const found = await common.findParentFolderTransformFiles('/home/user/transformDiscovery/perCamera');
      expect(found).toStrictEqual([
        npath.join('/home/user/transformDiscovery/perCamera', 'ir_to_eo_registration.json'),
        npath.join('/home/user/transformDiscovery/perCamera', 'uv_to_eo_registration.json'),
      ]);
    });

    it('accepts a *_registration.json with pairs but no type; other names still need the type', async () => {
      const found = await common.findParentFolderTransformFiles('/home/user/transformDiscovery/untypedPerCamera');
      expect(found).toStrictEqual([
        npath.join('/home/user/transformDiscovery/untypedPerCamera', 'uv_to_eo_registration.json'),
      ]);
    });

    it('returns empty when no self-identified registration json exists', async () => {
      expect(await common.findParentFolderTransformFiles('/home/user/transformDiscovery/none')).toStrictEqual([]);
    });

    it('returns empty for a missing directory', async () => {
      expect(await common.findParentFolderTransformFiles('/home/user/doesNotExist')).toStrictEqual([]);
    });
  });

  it('fromRegistrationPairs derives a missing matrix direction by inversion', () => {
    const { homographies } = common.fromRegistrationPairs([{
      left: 'eo',
      right: 'ir',
      points: [],
      leftToRight: null,
      rightToLeft: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
    }]);
    expect(homographies['eo::ir'].BtoA).toEqual([[1, 0, -5], [0, 1, 3], [0, 0, 1]]);
    expect(homographies['eo::ir'].AtoB[0][2]).toBeCloseTo(5);
    expect(homographies['eo::ir'].AtoB[1][2]).toBeCloseTo(-3);
  });

  it('fromRegistrationPairs keeps points but skips the matrix for singular input', () => {
    const { homographies, correspondences } = common.fromRegistrationPairs([{
      left: 'eo',
      right: 'ir',
      points: [[1, 2, 3, 4]],
      leftToRight: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      rightToLeft: null,
    }]);
    expect(homographies['eo::ir']).toBeUndefined();
    expect(correspondences['eo::ir']).toHaveLength(1);
  });

  it('saveConfig persists the registration source stamp and reloads it', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    const cameraHomographies = {
      'rgb::ir': {
        AtoB: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
        BtoA: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
      },
    };
    const source = { model: 'colmap-2026-07-01', swathe: 'fl07_C' };

    await common.saveConfig(settings, final.id, {
      cameraHomographies,
      cameraRegistrationSource: source,
    });

    const projectDir = npath.join(settings.dataPath, 'DIVE_Projects', final.id);
    const registrationPath = npath.join(projectDir, 'ir_to_rgb_registration.json');
    expect((await fs.readJSON(registrationPath)).source).toStrictEqual(source);
    const reloaded = await common.loadConfig(settings, final.id, urlMapper);
    expect(reloaded.cameraRegistrationSource).toStrictEqual(source);

    // A save that doesn't mention the stamp leaves it alone.
    await common.saveConfig(settings, final.id, {
      cameraTransformTypes: { 'rgb::ir': 'rigid' },
    });
    expect((await fs.readJSON(registrationPath)).source).toStrictEqual(source);

    // An explicit null clears it.
    await common.saveConfig(settings, final.id, {
      cameraHomographies,
      cameraRegistrationSource: null,
    });
    expect('source' in (await fs.readJSON(registrationPath))).toBe(false);
  });

  it('merges per-camera registration files and flags disagreeing source stamps', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    const projectDir = npath.join(settings.dataPath, 'DIVE_Projects', final.id);

    const irPair = {
      left: 'rgb', right: 'ir', points: [], leftToRight: [[1, 0, 5], [0, 1, -3], [0, 0, 1]], rightToLeft: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
    };
    const uvPair = {
      left: 'rgb', right: 'uv', points: [], leftToRight: [[1, 0, 8], [0, 1, 2], [0, 0, 1]], rightToLeft: [[1, 0, -8], [0, 1, -2], [0, 0, 1]],
    };
    await fs.writeJSON(npath.join(projectDir, 'ir_registration.json'), {
      version: 1, source: { producer: 'kamera', run: 'fl07' }, pairs: [irPair],
    });
    await fs.writeJSON(npath.join(projectDir, 'uv_registration.json'), {
      version: 1, source: { producer: 'kamera', run: 'fl09' }, pairs: [uvPair],
    });

    // Both pairs merge; the disagreeing stamps become a mixed composite so
    // the client can warn about a rig assembled from different generations.
    const mixed = await common.loadConfig(settings, final.id, urlMapper);
    expect(Object.keys(mixed.cameraHomographies ?? {}).sort()).toStrictEqual(['rgb::ir', 'rgb::uv']);
    expect(mixed.cameraRegistrationSource).toStrictEqual({
      mixed: true,
      files: {
        'ir_registration.json': { producer: 'kamera', run: 'fl07' },
        'uv_registration.json': { producer: 'kamera', run: 'fl09' },
      },
    });

    // Agreeing stamps stay a single plain stamp.
    await fs.writeJSON(npath.join(projectDir, 'uv_registration.json'), {
      version: 1, source: { producer: 'kamera', run: 'fl07' }, pairs: [uvPair],
    });
    const agreeing = await common.loadConfig(settings, final.id, urlMapper);
    expect(agreeing.cameraRegistrationSource).toStrictEqual({ producer: 'kamera', run: 'fl07' });

    // A save of the mixed set never stamps the per-camera files with the
    // composite (that would read as a unanimous rig on the next load).
    await fs.writeJSON(npath.join(projectDir, 'uv_registration.json'), {
      version: 1, source: { producer: 'kamera', run: 'fl09' }, pairs: [uvPair],
    });
    const beforeSave = await common.loadConfig(settings, final.id, urlMapper);
    await common.saveConfig(settings, final.id, {
      cameraHomographies: beforeSave.cameraHomographies,
      cameraRegistrationSource: beforeSave.cameraRegistrationSource,
    });
    expect('source' in (await fs.readJSON(npath.join(projectDir, 'ir_to_rgb_registration.json')))).toBe(false);
  });

  it('exportCameraRegistration writes a single per-camera file from the saved calibration', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    const cameraHomographies = {
      'rgb::ir': {
        AtoB: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
        BtoA: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
      },
      'rgb::uv': {
        AtoB: [[1, 0, 8], [0, 1, 2], [0, 0, 1]],
        BtoA: [[1, 0, -8], [0, 1, -2], [0, 0, 1]],
      },
    };
    const source = { producer: 'kamera', run: 'fl07' };
    await common.saveConfig(settings, final.id, {
      cameraHomographies,
      cameraRegistrationSource: source,
    });

    const destPath = '/home/user/output/ir_to_rgb_registration.json';
    await common.exportCameraRegistration(settings, final.id, destPath, 'ir');
    const exported = await fs.readJSON(destPath);
    // Self-identifies so parent-folder discovery recognizes it on re-import,
    // and carries only its own camera's pair plus the producer stamp.
    expect(exported.type).toBe('dive-camera-registration');
    expect(exported.source).toStrictEqual(source);
    expect(exported.pairs).toHaveLength(1);
    expect(exported.pairs[0].left).toBe('rgb');
    expect(exported.pairs[0].right).toBe('ir');
    expect(exported.pairs[0].leftToRight).toStrictEqual([[1, 0, 5], [0, 1, -3], [0, 0, 1]]);

    // A camera with no registration refuses.
    await expect(common.exportCameraRegistration(settings, final.id, '/home/user/output/nope.json', 'zz')).rejects.toThrow('no registration for camera');
  });

  it('importCameraRegistration merges an imported file over the saved calibration', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    await common.saveConfig(settings, final.id, {
      cameraHomographies: {
        'rgb::ir': {
          AtoB: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
          BtoA: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
        },
      },
      cameraRegistrationSource: { producer: 'kamera', run: 'fl07' },
    });

    // A per-camera file for a second camera merges in alongside the first.
    await fs.writeJSON('/home/user/output/uv_to_rgb_registration.json', {
      type: 'dive-camera-registration',
      version: 1,
      source: { producer: 'kamera', run: 'fl07' },
      pairs: [{
        left: 'rgb', right: 'uv', points: [], leftToRight: [[1, 0, 8], [0, 1, 2], [0, 0, 1]], rightToLeft: [[1, 0, -8], [0, 1, -2], [0, 0, 1]],
      }],
    });
    const result = await common.importCameraRegistration(settings, final.id, '/home/user/output/uv_to_rgb_registration.json');
    expect(result).toStrictEqual({ cameras: ['rgb', 'uv'], pairCount: 1 });

    const reloaded = await common.loadConfig(settings, final.id, urlMapper);
    expect(Object.keys(reloaded.cameraHomographies ?? {}).sort()).toStrictEqual(['rgb::ir', 'rgb::uv']);
    // Agreeing stamps stay a single plain stamp, persisted into the files.
    expect(reloaded.cameraRegistrationSource).toStrictEqual({ producer: 'kamera', run: 'fl07' });
    const projectDir = npath.join(settings.dataPath, 'DIVE_Projects', final.id);
    expect(await fs.pathExists(npath.join(projectDir, 'uv_to_rgb_registration.json'))).toBe(true);

    // A malformed file refuses without touching the dataset.
    await fs.writeFile('/home/user/output/broken.json', '{not json');
    await expect(common.importCameraRegistration(settings, final.id, '/home/user/output/broken.json')).rejects.toThrow('not valid JSON');
    await fs.writeJSON('/home/user/output/nopairs.json', { calibrations: {} });
    await expect(common.importCameraRegistration(settings, final.id, '/home/user/output/nopairs.json')).rejects.toThrow('expected a "pairs" list');
  });

  it('importCameraRegistration scoped to a camera takes only that camera\'s pairs', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    await common.saveConfig(settings, final.id, {
      cameraHomographies: {
        'rgb::ir': {
          AtoB: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
          BtoA: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
        },
      },
    });

    // A file holding two pairs, imported scoped to uv: only the uv pair lands.
    await fs.writeJSON('/home/user/output/allpairs.json', {
      type: 'dive-camera-registration',
      version: 1,
      pairs: [
        {
          left: 'rgb', right: 'ir', points: [], leftToRight: [[2, 0, 0], [0, 2, 0], [0, 0, 1]], rightToLeft: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 1]],
        },
        {
          left: 'rgb', right: 'uv', points: [], leftToRight: [[1, 0, 8], [0, 1, 2], [0, 0, 1]], rightToLeft: [[1, 0, -8], [0, 1, -2], [0, 0, 1]],
        },
      ],
    });
    const scoped = await common.importCameraRegistration(settings, final.id, '/home/user/output/allpairs.json', { camera: 'uv' });
    expect(scoped).toStrictEqual({ cameras: ['rgb', 'uv'], pairCount: 1 });
    const merged = await common.loadConfig(settings, final.id, urlMapper);
    expect(Object.keys(merged.cameraHomographies ?? {}).sort()).toStrictEqual(['rgb::ir', 'rgb::uv']);
    // The scoped import left the existing ir pair untouched.
    expect(merged.cameraHomographies?.['rgb::ir'].AtoB).toStrictEqual([[1, 0, 5], [0, 1, -3], [0, 0, 1]]);

    // Re-importing scoped to ir replaces that pair while keeping uv.
    await common.importCameraRegistration(settings, final.id, '/home/user/output/allpairs.json', { camera: 'ir' });
    const replaced = await common.loadConfig(settings, final.id, urlMapper);
    expect(Object.keys(replaced.cameraHomographies ?? {}).sort()).toStrictEqual(['rgb::ir', 'rgb::uv']);
    expect(replaced.cameraHomographies?.['rgb::ir'].AtoB).toStrictEqual([[2, 0, 0], [0, 2, 0], [0, 0, 1]]);

    // Scoping to a camera the file doesn't name refuses.
    await expect(common.importCameraRegistration(settings, final.id, '/home/user/output/allpairs.json', { camera: 'zz' })).rejects.toThrow('no pairs for camera "zz"');
  });

  it('exportCameraRegistration never stamps exported files with a mixed composite', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    const final = res.meta;
    // A mixed composite stamp describes the assembled set, not any single
    // file; stamping an exported file with it would present a unanimous rig.
    await common.saveConfig(settings, final.id, {
      cameraHomographies: {
        'rgb::ir': {
          AtoB: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
          BtoA: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
        },
      },
      cameraRegistrationSource: {
        mixed: true,
        files: { 'ir_registration.json': { producer: 'kamera', run: 'fl07' } },
      },
    });

    const destPath = '/home/user/output/ir_to_rgb_registration.json';
    await common.exportCameraRegistration(settings, final.id, destPath, 'ir');
    expect('source' in (await fs.readJSON(destPath))).toBe(false);
  });

  it('exportCameraRegistration refuses when the dataset has no calibration', async () => {
    const payload = await common.beginMediaImport(
      '/home/user/data/imageLists/success/image_list.txt',
    );
    const res = await common.finalizeMediaImport(settings, payload);
    await expect(common.exportCameraRegistration(settings, res.meta.id, '/home/user/output/none.json', 'ir')).rejects.toThrow('no camera registration to export');
  });

  it('import with CSV annotations without specifying track file', async () => {
    const payload = await common.beginMediaImport('/home/user/data/imageSuccessWithAnnotations');
    payload.trackFileAbsPath = ''; //It returns null be default but users change it.
    payload.jsonConfig.fps = 12; // simulate user specify FPS action
    await common.finalizeMediaImport(settings, payload);
    const meta = await common.loadConfig(settings, payload.jsonConfig.id, urlMapper);
    expect(meta.fps).toBe(12);
  });

  it('import with CSV annotations with specifying track file', async () => {
    const payload = await common.beginMediaImport('/home/user/data/imageSuccessWithAnnotations');
    payload.trackFileAbsPath = '/home/user/data/imageSuccessWithAnnotations/file1.csv';
    payload.jsonConfig.fps = 12; // simulate user specify FPS action
    await common.finalizeMediaImport(settings, payload);
    const meta = await common.loadConfig(settings, payload.jsonConfig.id, urlMapper);
    expect(meta.fps).toBe(32);
  });

  it('import with user selected FPS > originalFPS', async () => {
    const payload = await common.beginMediaImport('/home/user/data/videoSuccess/video1.mp4');
    payload.jsonConfig.fps = 50; // above 30
    await common.finalizeMediaImport(settings, payload);
    const meta1 = await common.loadConfig(settings, payload.jsonConfig.id, urlMapper);
    expect(meta1.fps).toBe(30);

    payload.jsonConfig.fps = -1; // above 30
    await common.finalizeMediaImport(settings, payload);
    const meta2 = await common.loadConfig(settings, payload.jsonConfig.id, urlMapper);
    expect(meta2.fps).toBe(1);
  });

  it('importMedia video success', async () => {
    const payload = await common.beginMediaImport('/home/user/data/videoSuccess/video1.mp4');
    expect(payload.jsonConfig.name).toBe('video1');
    expect(payload.jsonConfig.originalImageFiles.length).toBe(0);
    expect(payload.jsonConfig.originalVideoFile).toBe('video1.mp4');
    expect(payload.jsonConfig.originalBasePath).toBe('/home/user/data/videoSuccess');
    expect(payload.jsonConfig.fps).toBe(5); // 5 is still the default
  });

  it('importMedia empty json file success', async () => {
    const payload = await common.beginMediaImport('/home/user/data/annotationEmptySuccess/video1.mp4');
    await common.finalizeMediaImport(settings, payload);
    const annotations = await common.loadDetections(settings, payload.jsonConfig.id);
    expect(annotations).toEqual(makeEmptyAnnotationFile());
  });

  it('importMedia include meta.json file ', async () => {
    const payload = await common.beginMediaImport('/home/user/data/metaJsonIncluded/video1.mp4');
    expect(payload.configFileAbsPath).toBe('/home/user/data/metaJsonIncluded/meta.json');
    await common.finalizeMediaImport(settings, payload);
    const tracks = await common.loadDetections(settings, payload.jsonConfig.id);
    const meta = await common.loadConfig(settings, payload.jsonConfig.id, urlMapper);
    expect(meta?.customTypeStyling?.other.color).toBe('blue');
    expect(tracks).toEqual(makeEmptyAnnotationFile());
  });

  it('Export  meta.json file ', async () => {
    const payload = await common.beginMediaImport('/home/user/data/metaJsonIncluded/video1.mp4');
    expect(payload.configFileAbsPath).toBe('/home/user/data/metaJsonIncluded/meta.json');
    await common.finalizeMediaImport(settings, payload);
    const tracks = await common.loadDetections(settings, payload.jsonConfig.id);
    const meta = await common.loadConfig(settings, payload.jsonConfig.id, urlMapper);
    expect(meta?.customTypeStyling?.other.color).toBe('blue');
    expect(tracks).toEqual(makeEmptyAnnotationFile());
    await common.exportConfiguration(settings, { id: payload.jsonConfig.id, path: '/home/user/output/test.json' });
    const outputMeta = await fs.readJSON('/home/user/output/test.json');
    expect(outputMeta?.customTypeStyling?.other.color).toBe('blue');
  });

  it('importMedia various failure modes', async () => {
    await expect(common.beginMediaImport('/fake/path'))
      .rejects.toThrow('file or directory not found');
    await expect(common.beginMediaImport('/home/user/data/imageSuccess/foo.png'))
      .rejects.toThrow('chose image file for video import option');
    await expect(common.beginMediaImport('/home/user/data/videoSuccess/otherfile.txt'))
      .rejects.toThrow('No images in input image list');
    await expect(common.beginMediaImport('/home/user/data/videoSuccess/nomime'))
      .rejects.toThrow('could not determine video MIME');
  });
  it('import first CSV in list', async () => {
    const payload = await common.beginMediaImport('/home/user/data/multiCSV/video1.mp4');
    await common.finalizeMediaImport(settings, payload);
    const tracks = await common.loadDetections(settings, payload.jsonConfig.id);
    expect(tracks).toEqual(makeEmptyAnnotationFile());
  });

  it('importMedia video, has conversion file list', async () => {
    const payload = await common.beginMediaImport('/home/user/data/videoSuccess/video1.avi');
    const conversionArgs = await common.finalizeMediaImport(settings, payload);
    expect(conversionArgs.mediaList.length).toBeGreaterThan(0);
  });

  it('check Dastset existence', async () => {
    await expect(common.checkDataset(settings, 'projectid3Bad')).rejects.toThrow('missing dataset json');
    await expect(common.checkDataset(settings, 'projectid5Bad')).rejects.toThrow('missing track json file');
    await expect(common.checkDataset(settings, 'missingFolder')).rejects.toThrow('missing project directory');
  });

  it('checkDataset does not create directories for missing datasets', async () => {
    await expect(common.checkDataset(settings, 'missingFolder')).rejects.toThrow();
    expect(fs.existsSync('/home/user/viamedata/DIVE_Projects/missingFolder')).toBe(false);
  });

  it('delete datasets', async () => {
    await expect(common.deleteDataset(settings, 'missingFolder')).resolves.toBe(true);
    let exists = fs.existsSync('/home/user/viamedata/DIVE_Projects/projectid5Bad');
    expect(exists).toBe(true);
    exists = fs.existsSync('/home/user/viamedata/DIVE_Projects/projectid6Delete');
    expect(exists).toBe(true);
    const deleted = await common.deleteDataset(settings, 'projectid6Delete');
    expect(deleted).toBe(true);
    exists = fs.existsSync('/home/user/viamedata/DIVE_Projects/projectid6Delete');
    expect(exists).toBe(false);
  });

  it('delete incomplete datasets', async () => {
    await expect(common.deleteDataset(settings, 'projectid3Bad')).resolves.toBe(true);
    expect(fs.existsSync('/home/user/viamedata/DIVE_Projects/projectid3Bad')).toBe(false);
    await expect(common.deleteDataset(settings, 'projectid5Bad')).resolves.toBe(true);
    expect(fs.existsSync('/home/user/viamedata/DIVE_Projects/projectid5Bad')).toBe(false);
  });

  it('delete rejects paths outside the projects folder', async () => {
    await expect(common.deleteDataset(settings, '../DIVE_Jobs')).rejects.toThrow('not a dataset directory');
    expect(fs.existsSync('/home/user/viamedata/DIVE_Jobs')).toBe(true);
  });

  it('delete stereo dataset', async () => {
    let exists = fs.existsSync('/home/user/viamedata/DIVE_Projects/stereoDataset');
    let leftExists = fs.existsSync('/home/user/viamedata/DIVE_Projects/stereoDataset/left');
    expect(exists).toBe(true);
    expect(leftExists).toBe(true);
    let deleted = await common.deleteDataset(settings, 'stereoDataset/left');
    expect(deleted).toBe(true);
    leftExists = fs.existsSync('/home/user/viamedata/DIVE_Projects/stereoDataset/left');
    expect(leftExists).toBe(false);
    let rightExists = fs.existsSync('/home/user/viamedata/DIVE_Projects/stereoDataset/right');
    expect(rightExists).toBe(true);
    deleted = await common.deleteDataset(settings, 'stereoDataset');
    expect(deleted).toBe(true);
    rightExists = fs.existsSync('/home/user/viamedata/DIVE_Projects/stereoDataset/right');
    expect(rightExists).toBe(false);
    exists = fs.existsSync('/home/user/viamedata/DIVE_Projects/stereoDataset');
    expect(exists).toBe(false);
  });

  it('processing good Trained Pipeline folder', async () => {
    const trainingArgs: RunTraining = {
      type: JobType.RunTraining,
      datasetIds: ['randomID'],
      pipelineName: 'trainedPipelineName',
      trainingConfig: 'trainingConfig',
      annotatedFramesOnly: false,
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
      type: JobType.RunTraining,
      datasetIds: ['randomID'],
      pipelineName: 'trainedBadPipelineName',
      trainingConfig: 'trainingConfig',
      annotatedFramesOnly: false,
    };
    await expect(common.processTrainedPipeline(settings, trainingArgs, '/home/user/viamedata/DIVE_Jobs/badTrainingJob/')).rejects.toThrow(
      'Path: /home/user/viamedata/DIVE_Jobs/badTrainingJob/category_models does not exist',
    );
    await expect(common.processTrainedPipeline(settings, trainingArgs, '/home/user/viamedata/DIVE_Jobs/missingPipeTrainingJob/')).rejects.toThrow(
      'Could not located trained pipe file inside of /home/user/viamedata/DIVE_Jobs/missingPipeTrainingJob/category_models',
    );
  });

  it('getPipelineList lists pipelines with Trained pipelines', async () => {
    const trainingArgs: RunTraining = {
      type: JobType.RunTraining,
      datasetIds: ['randomID'],
      pipelineName: 'trainedPipelineName',
      trainingConfig: 'trainingConfig',
      annotatedFramesOnly: false,
    };
    const contents = await common.processTrainedPipeline(settings, trainingArgs, '/home/user/viamedata/DIVE_Jobs/goodTrainingJob/');
    expect(contents).toEqual(['detector.pipe', 'trained_detector.zip']);
    //Data should be moved out of the current folder
    const sourceFolder = fs.readdirSync('/home/user/viamedata/DIVE_Jobs/goodTrainingJob/category_models');
    expect(sourceFolder.length).toBe(0);
    //Folders hould be created for new pipeline
    const pipelineFolder = '/home/user/viamedata/DIVE_Pipelines/trainedPipelineName';
    const pipelineFolderExists = fs.existsSync(pipelineFolder);
    expect(pipelineFolderExists).toBe(true);

    const exists = await fs.pathExists(settings.viamePath);
    expect(exists).toBe(true);
    const pipes = await common.getPipelineList(settings);
    expect(pipes).toBeTruthy();
    expect(pipes.detector.pipes).toHaveLength(4);
    expect(pipes.tracker.pipes).toHaveLength(5);
    expect(pipes.utility.pipes).toHaveLength(4);
    expect(pipes.trained.pipes).toHaveLength(1);
  });

  it('Full Annotation Loading and Attributes Testing', async () => {
    for (let num = 0; num < testData.length; num += 1) {
      // eslint-disable-next-line no-await-in-loop
      const payload = await common.beginMediaImport(
        `/home/user/testPairs/test${num}`,
      );
      expect(payload.jsonConfig.originalImageFiles).toEqual([
        '1.png',
        '2.png',
        '3.png',
        '4.png',
        '5.png',
        '6.png',
        '7.png',
        '8.png',
        '9.png',
      ]);
      // eslint-disable-next-line no-await-in-loop
      const res = await common.finalizeMediaImport(settings, payload);
      const final = res.meta;
      expect(final.attributes).toEqual(testData[num][2]);
      // eslint-disable-next-line no-await-in-loop
      const tracks = await common.loadDetections(settings, final.id);
      const modifiedSource = {
        groups: {},
        tracks: testData[num][1],
        version: AnnotationsCurrentVersion,
      };
      expect(tracks).toEqual(modifiedSource);
    }
  });
});

describe('resumable training jobs', () => {
  const jobsDir = '/home/user/viamedata/DIVE_Jobs';
  const baseManifest = {
    key: 'key',
    command: 'viame train',
    jobType: 'training',
    title: 'fish detector',
    args: {
      type: JobType.RunTraining,
      datasetIds: ['datasetId'],
      pipelineName: 'fish detector',
      trainingConfig: 'train.conf',
      annotatedFramesOnly: false,
    },
    datasetIds: ['datasetId'],
    pid: 999999999,
    exitCode: null,
    startTime: new Date('2026-01-01T00:00:00Z'),
  };

  /* mock-fs cannot intercept writeFileSync on newer node, so job directories
   * are seeded through the mockfs() config instead of written at runtime */
  function jobDirConfig(
    name: string,
    manifestOverrides: Record<string, unknown>,
    files = ['deep_training', 'input_folder_list.txt', 'input_truth_list.txt'],
  ) {
    const entries: Record<string, string | Record<string, never>> = {};
    files.forEach((f) => {
      entries[f] = f.includes('.') ? '' : {};
    });
    entries['dive_job_manifest.json'] = JSON.stringify({
      ...baseManifest,
      workingDir: npath.join(jobsDir, name),
      ...manifestOverrides,
    });
    return entries;
  }

  function mockJobsFolder(jobs: Record<string, Record<string, string | Record<string, never>>>) {
    mockfs({
      '/home/user/viamedata': {
        DIVE_Jobs: jobs,
        DIVE_Projects: {},
      },
    });
  }

  it('finds interrupted runs with intermediate files, newest first', async () => {
    mockJobsFolder({
      crashed: jobDirConfig('crashed', { endTime: new Date('2026-01-01T01:00:00Z'), exitCode: 139 }),
      cancelled: jobDirConfig('cancelled', {
        startTime: new Date('2026-01-02T00:00:00Z'),
        endTime: new Date('2026-01-02T01:00:00Z'),
        exitCode: -1,
      }),
    });
    const found = await common.findResumableTrainingJobs(settings);
    expect(found.map((j) => j.workingDir)).toEqual([
      npath.join(jobsDir, 'cancelled'),
      npath.join(jobsDir, 'crashed'),
    ]);
  });

  it('excludes successful, still running, and stateless runs', async () => {
    mockJobsFolder({
      succeeded: jobDirConfig('succeeded', { endTime: new Date(), exitCode: 0 }),
      running: jobDirConfig('running', { pid: process.pid }),
      noTrainerState: jobDirConfig('noTrainerState', { endTime: new Date(), exitCode: 1 }, ['input_folder_list.txt', 'input_truth_list.txt']),
      interrupted: jobDirConfig('interrupted', { endTime: new Date(), exitCode: 1 }),
    });
    const found = await common.findResumableTrainingJobs(settings);
    expect(found.map((j) => j.workingDir)).toEqual([npath.join(jobsDir, 'interrupted')]);
  });

  it('excludes legacy successful runs with an emptied category_models', async () => {
    mockJobsFolder({
      legacySuccess: jobDirConfig(
        'legacySuccess',
        {},
        ['deep_training', 'category_models', 'input_folder_list.txt', 'input_truth_list.txt'],
      ),
      legacyInterrupted: jobDirConfig('legacyInterrupted', {}),
    });
    const found = await common.findResumableTrainingJobs(settings);
    expect(found.map((j) => j.workingDir)).toEqual([npath.join(jobsDir, 'legacyInterrupted')]);
  });

  it('discard removes only job working directories', async () => {
    mockJobsFolder({
      discardMe: jobDirConfig('discardMe', { endTime: new Date(), exitCode: 1 }),
    });
    const dir = npath.join(jobsDir, 'discardMe');
    await common.discardResumableTraining(settings, dir);
    expect(fs.existsSync(dir)).toBe(false);
    await expect(common.discardResumableTraining(settings, '/home/user/viamedata/DIVE_Projects'))
      .rejects.toThrow('not a job working directory');
  });
});

describe('buildTrainingExitManifest', () => {
  const jobBase: DesktopJob = {
    key: 'key',
    command: 'viame train',
    jobType: 'training',
    title: 'fish detector',
    args: {
      type: JobType.RunTraining,
      datasetIds: ['datasetId'],
      pipelineName: 'fish detector',
      trainingConfig: 'train.conf',
      annotatedFramesOnly: false,
    },
    datasetIds: ['datasetId'],
    pid: 1234,
    workingDir: '/jobs/run',
    exitCode: null,
    startTime: new Date('2026-01-01T00:00:00Z'),
  };
  const endTime = new Date('2026-01-01T02:00:00Z');

  it('preserves cancel status over a null/signal process exit code', () => {
    const cancelTime = new Date('2026-01-01T01:30:00Z');
    const result = buildTrainingExitManifest(jobBase, null, endTime, {
      cancelledJob: true,
      exitCode: -1,
      endTime: cancelTime,
    });
    expect(result.cancelledJob).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(result.endTime).toEqual(cancelTime);
  });

  it('records the process exit code when the job was not cancelled', () => {
    const result = buildTrainingExitManifest(jobBase, 1, endTime, { exitCode: null });
    expect(result.cancelledJob).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.endTime).toEqual(endTime);
  });
});

describe('frame metadata read path (source text loading)', () => {
  it('loads a single-camera reserved-name fallback as the shared attachment', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidFrameMetadata');
    expect(data.cameras).toEqual({});
    expect(data.shared?.name).toBe('frame-metadata.txt');
    expect(data.shared?.text).toContain('image_0001.jpg');
    expect(data.shared?.text).toContain('depth');
  });

  it('uses the selected metadata attachment without adding a reserved fallback', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidMetadataAttachment');
    expect(data.cameras).toEqual({});
    expect(data.shared?.name).toBe('flight_log.csv');
    expect(data.shared?.text).toContain('image_0001.jpg,120');
  });

  it('reports more than one reserved-name fallback instead of merging them', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidFrameMetadataAmbiguous');
    expect(data).toEqual({
      shared: {
        name: 'Metadata File',
        error: 'More than one reserved-name metadata attachment is available.',
      },
      cameras: {},
    });
  });

  it('omits a camera whose only text file is not a declared sidecar', async () => {
    await expect(common.loadFrameMetadata(settings, 'projectidFrameMetadataNoSource'))
      .resolves.toEqual({ cameras: {} });
  });

  it('loads a sidecar that names double-extension media by full name', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidFrameMetadataDoubleExt');
    expect(data.shared?.name).toBe('frame_metadata.csv');
    expect(data.shared?.text).toContain('photo.jpg.png');
  });

  it('loads a sidecar for duplicate image basenames without validating media keys', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidFrameMetadataDup');
    expect(data.shared?.name).toBe('frame_metadata.csv');
    expect(data.shared?.text).toContain('image_0001.jpg');
  });

  it('returns a multicam shared root attachment once', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidMulticamRootDedup');
    expect(data.cameras).toEqual({});
    expect(data.shared?.name).toBe('frame_metadata.csv');
    expect(data.shared?.text).toContain('img_l1.jpg');
  });

  it('returns shared and camera-local multicam attachments at their own scopes', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidMulticamSharedRoot');
    expect(data.shared?.name).toBe('frame_metadata.csv');
    expect(data.shared?.text).toContain('img_r1.jpg');
    expect(data.cameras.left.name).toBe('left-local.csv');
    expect(data.cameras.left.text).toContain('other.jpg,999');
    expect(data.cameras.right).toBeUndefined();
  });

  it('keeps a camera-local reserved attachment beside an explicit shared one', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidMulticamExplicitShared');
    expect(data.shared?.name).toBe('flight_log.csv');
    expect(data.shared?.text).toContain('img_l1.jpg,120');
    expect(data.cameras.right.name).toBe('frame_metadata.csv');
    expect(data.cameras.right.text).toContain('img_r1.jpg,300');
    expect(data.cameras.left).toBeUndefined();
  });

  it('resolves a multicam whose base path is an image list file, not a directory', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidMulticamImageList');
    expect(data.shared?.name).toBe('frame_metadata.csv');
    expect(data.shared?.text).toContain('img_l1.jpg,10');
    expect(data.cameras).toEqual({});
  });

  it('loads a single-camera video reserved-name fallback', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectid1VideoGood');
    expect(data.cameras).toEqual({});
    expect(data.shared?.name).toBe('frame_metadata.csv');
    expect(data.shared?.text).toContain('2,30');
  });

  it('loads shared and camera-local multicamera video attachments', async () => {
    const data = await common.loadFrameMetadata(settings, 'projectidMulticamVideoMetadata');
    expect(data.shared?.name).toBe('frame_metadata.csv');
    expect(data.shared?.text).toContain('2,long-camera');
    expect(data.cameras.left.name).toBe('left-local.csv');
    expect(data.cameras.left.text).toContain('0,local');
    expect(data.cameras.right).toBeUndefined();
  });
});

describe('frame metadata discovery', () => {
  it('frameMetadataSourceDirectories returns the base path for a directory import', () => {
    expect(common.frameMetadataSourceDirectories({
      originalBasePath: '/data/set',
      originalImageFiles: ['img001.png'],
    })).toEqual([npath.resolve('/data/set')]);
  });

  it('frameMetadataSourceDirectories lists the image-list directory then the absolute image directory', () => {
    expect(common.frameMetadataSourceDirectories({
      originalBasePath: '',
      originalImageFiles: ['/imgs/a.png'],
      imageListPath: '/lists/list.txt',
    })).toEqual([npath.resolve('/lists'), npath.resolve('/imgs')]);
  });

  it('frameMetadataSourceDirectories lists every absolute image directory from image-list entries', () => {
    expect(common.frameMetadataSourceDirectories({
      originalBasePath: '',
      originalImageFiles: ['/imgs/a.png', '/extra/b.png', '/imgs/c.png'],
      imageListPath: '/lists/list.txt',
    })).toEqual([npath.resolve('/lists'), npath.resolve('/imgs'), npath.resolve('/extra')]);
  });

  it('frameMetadataSourceDirectories dedupes directories that resolve to the same path', () => {
    expect(common.frameMetadataSourceDirectories({
      originalBasePath: '/data',
      originalImageFiles: ['/data/a.png'],
      imageListPath: '/data/list.txt',
    })).toEqual([npath.resolve('/data')]);
  });

  it('frameMetadataSourceDirectories supports a video media directory', () => {
    expect(common.frameMetadataSourceDirectories({
      originalBasePath: '/data/video',
      originalVideoFile: 'movie.mp4',
    })).toEqual([npath.resolve('/data/video')]);
  });

  it('frameMetadataSourceDirectories ignores a relative first image (covered by the base path)', () => {
    expect(common.frameMetadataSourceDirectories({
      originalBasePath: '/base',
      originalImageFiles: ['sub/a.png'],
    })).toEqual([npath.resolve('/base')]);
  });
});

describe('frame metadata import gates', () => {
  it('picks the annotation CSV and leaves a declared frame metadata sidecar in place', async () => {
    // 'frame_metadata.csv' sorts first but is declared frame metadata: it must be skipped as a
    // track-file candidate and stay on disk for read-time discovery.
    const dir = '/home/user/data/fmGateMixed';
    const payload = await common.beginMediaImport(dir);
    expect(payload.trackFileAbsPath).toBe(npath.join(dir, 'zzz_annotations.csv'));
    expect(payload.metadataFileAbsPath).toBe(npath.join(dir, 'frame_metadata.csv'));
    expect(fs.existsSync(npath.join(dir, 'frame_metadata.csv'))).toBe(true);
  });

  it('leaves no track file when only a declared frame metadata sidecar is present', async () => {
    const payload = await common.beginMediaImport('/home/user/data/fmGateFrameMetadataOnly');
    expect(payload.trackFileAbsPath).toBeFalsy();
  });

  it('rejects an explicit import of a frame metadata file', async () => {
    await expect(common.ingestDataFiles(
      settings,
      'projectid1',
      ['/home/user/data/fmGateExplicit/frame_metadata.csv'],
    )).rejects.toThrow(/frame metadata file/);
  });

  it('hints at the rename convention when a plain frame-metadata-shaped CSV fails VIAME import', async () => {
    await expect(common.ingestDataFiles(
      settings,
      'projectid1',
      ['/home/user/data/fmGateViameFail/nav.csv'],
    )).rejects.toThrow(/rename it to frame-metadata\.csv/);
  });
});

afterEach(() => {
  mockfs.restore();
});
