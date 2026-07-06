import { DatasetType } from './apispec';

const ImageSequenceType = 'image-sequence';
const VideoType = 'video';
const MultiType = 'multi';
const LargeImageType = 'large-image';

const MediaTypes: Record<DatasetType, string> = {
  // friendly media type names
  [ImageSequenceType]: 'image sequence',
  [VideoType]: 'video',
  [MultiType]: 'multi',
  [LargeImageType]: 'tiled image',
};

const DefaultVideoFPS = -1;
const FPSOptions = [
  { text: 1, value: 1 },
  { text: 5, value: 5 },
  { text: 10, value: 10 },
  { text: 15, value: 15 },
  { text: 24, value: 24 },
  { text: 25, value: 25 },
  { text: 30, value: 30 },
  { text: 50, value: 50 },
  { text: 60, value: 60 },
  { text: 'Video FPS', value: -1 },
];

const itemsPerPageOptions = [20, 50, 100];

const websafeVideoTypes = [
  'video/mp4',
  'video/webm',
];

const otherVideoTypes = [
  /* avi */
  'video/avi',
  'video/msvideo',
  'video/x-msvideo',
  'video/x-ms-wmv',
  /* mov */
  'video/quicktime',
  /* mpeg */
  'video/mpeg',
  'video/x-mpeg',
  'video/x-mpeq2a',
  /* ogg */
  'video/ogg',
  /* flv */
  'video/x-flv',
];

const calibrationFileTypes = [
  'cam',
  'json',
  'npz',
  'yml',
  'zip',
];

const fileVideoTypes = [
  'mp4',
  'webm',
  'avi',
  'mov',
  'wmv',
  'mpg',
  'mpeg',
  'mp2',
  'ogg',
  'flv',
];

const largeImageTypes = [
  'image/geotiff',
  'image/tiff',
  'image/tif',
  'image/x-tiff',
  'image/nitf',
  'image/ntf',
];

/** Extension-only formats for large-image uploads (aligned with server validLargeImageFormats). */
const largeImageFileExtensions = [
  'nitf',
  'tif',
  'tiff',
  'ntf',
  'vrt',
  'r0',
  'r1',
  'r2',
  'r3',
  'r4',
  'r5',
  'r6',
];

/** Desktop Electron open-dialog extensions (GeoTIFF/TIFF only; tiles served via geotiff.js). */
const largeImageDesktopTypes = [
  'geotiff',
  'tiff',
  'tif',
];

/** MIME types and dotted extensions for HTML file input accept on web. */
const largeImageWebAccept = [
  ...largeImageTypes,
  ...largeImageFileExtensions.map((ext) => `.${ext}`),
].join(',');

/** Dotted extensions for desktop-mode file inputs in the web upload UI. */
const largeImageDesktopAccept = largeImageDesktopTypes.map((ext) => `.${ext}`).join(',');

function getLargeImageFileAccept(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) {
    return largeImageDesktopAccept;
  }
  return largeImageWebAccept;
}

function getLargeImageAllowedExtensions(): string[] {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) {
    return largeImageDesktopTypes;
  }
  return largeImageFileExtensions;
}

const websafeImageTypes = [
  // 'image/apng',
  // 'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  // 'image/svg+xml',
  // 'image/webp',
];

const otherImageTypes = [
  'image/avif',
  'image/tiff',
  'image/bmp',
  'image/x-windows-bmp',
  'image/sgi',
  'image/x-portable-graymap',
];

const inputAnnotationTypes = [
  'application/json',
  'text/csv',
  'text/yaml',
  'application/x-yaml',
];

const inputAnnotationFileTypes = [
  'yml',
  'yaml',
  'json',
  'csv',
];

const listFileTypes = [
  'txt',
];

/**
 * Per-camera alignment transform files: DIVE calibration .json (the
 * calibration panel's save format) or legacy ITK .h5 (HDF5-serialized, e.g.
 * from itk_point_set_to_transform).
 */
const transformFileTypes = [
  'json',
  'h5',
];

const zipFileTypes = [
  'zip',
];

const stereoPipelineMarker = 'measurement';
/** Girder item meta key marking the original stereoscopic calibration upload (pipeline input). */
const calibrationFileMarker = 'calibrationFile';
/** Girder item meta key marking the JSON camera-rig used for calibration display. */
const jsonCalibrationFileMarker = 'jsonCalibrationFile';
/** Legacy common_stereo category key; never shown in the run-pipeline menu. */
const hiddenPipelineCategories = ['stereo'];
/** Pipeline name/category substrings hidden from the web run-pipeline menu. */
const webExcludedPipelineTerms = ['seagis'];
const multiCamPipelineMarkers = ['2-cam', '3-cam'];
const pipelineCreatesDatasetMarkers = ['transcode', 'filter'];

const JsonMetaRegEx = /^.*\.?(meta|config)\.json$/;

function simplifyTrainingName(item: string) {
  return item.replace('.conf', '');
}

export {
  DefaultVideoFPS,
  ImageSequenceType,
  VideoType,
  LargeImageType,
  MediaTypes,
  MultiType,
  FPSOptions,
  itemsPerPageOptions,
  calibrationFileTypes,
  fileVideoTypes,
  otherImageTypes,
  otherVideoTypes,
  websafeImageTypes,
  websafeVideoTypes,
  inputAnnotationTypes,
  largeImageTypes,
  largeImageFileExtensions,
  largeImageDesktopTypes,
  largeImageWebAccept,
  largeImageDesktopAccept,
  getLargeImageFileAccept,
  getLargeImageAllowedExtensions,
  inputAnnotationFileTypes,
  listFileTypes,
  transformFileTypes,
  zipFileTypes,
  stereoPipelineMarker,
  calibrationFileMarker,
  jsonCalibrationFileMarker,
  hiddenPipelineCategories,
  webExcludedPipelineTerms,
  multiCamPipelineMarkers,
  pipelineCreatesDatasetMarkers,
  JsonMetaRegEx,
  simplifyTrainingName,
};
