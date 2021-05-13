const ImageSequenceType = 'image-sequence';
const VideoType = 'video';

const MediaTypes = {
  // friendly media type names
  [ImageSequenceType]: 'image sequence',
  [VideoType]: 'video',
};

const DefaultVideoFPS = 10;

const websafeVideoTypes = [
  'video/mp4',
  'video/webm',
];

const otherVideoTypes = [
  /* avi */
  'vide/avi',
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
];

const inputAnnotationFileTypes = [
  'json',
  'csv',
];

export {
  DefaultVideoFPS,
  ImageSequenceType,
  VideoType,
  MediaTypes,
  calibrationFileTypes,
  fileVideoTypes,
  otherImageTypes,
  otherVideoTypes,
  websafeImageTypes,
  websafeVideoTypes,
  inputAnnotationTypes,
  inputAnnotationFileTypes,
};
