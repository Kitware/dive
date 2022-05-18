import { DatasetType } from './apispec';

const ImageSequenceType = 'image-sequence';
const VideoType = 'video';
const MultiType = 'multi';

const MediaTypes: Record<DatasetType, string> = {
  // friendly media type names
  [ImageSequenceType]: 'image sequence',
  [VideoType]: 'video',
  [MultiType]: 'multi',
};

const DefaultVideoFPS = 10;
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
  'npz',
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

const zipFileTypes = [
  'zip',
];

const stereoPipelineMarker = 'measurement';
const multiCamPipelineMarkers = ['2-cam', '3-cam'];

const JsonMetaRegEx = /^.*\.?(meta|config)\.json$/;

function simplifyTrainingName(item: string) {
  return item.replace('.viame_csv.conf', '');
}


export {
  DefaultVideoFPS,
  ImageSequenceType,
  VideoType,
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
  inputAnnotationFileTypes,
  listFileTypes,
  zipFileTypes,
  stereoPipelineMarker,
  multiCamPipelineMarkers,
  JsonMetaRegEx,
  simplifyTrainingName,
};
