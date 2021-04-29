const ImageSequenceType = 'image-sequence';
const VideoType = 'video';

const MediaTypes = {
  // friendly media type names
  [ImageSequenceType]: 'image sequence',
  [VideoType]: 'video',
};

const DefaultVideoFPS = 10;
const FPSOptions = [1, 5, 10, 15, 24, 25, 30, 50, 60];

export {
  DefaultVideoFPS,
  ImageSequenceType,
  VideoType,
  MediaTypes,
  FPSOptions,
};
