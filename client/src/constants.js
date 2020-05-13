const ImageSequenceType = 'image-sequence';
const VideoType = 'video';

// Supported File Types
const videoFileTypes = ['.mp4', '.avi', '.mov', '.mpg'];
const webFriendlyImageFileTypes = ['.jpg', '.jpeg', '.png'];
const imageFileTypes = [...webFriendlyImageFileTypes, '.bmp', '.sgi', '.tif', '.tiff', '.pgm'];

// Utility for commonly used regular expressions
const videoFilesRegEx = new RegExp(`${videoFileTypes.join('$|')}$`, 'i');
const imageFilesRegEx = new RegExp(`${imageFileTypes.join('$|')}$`, 'i');
const webFriendlyImageRegEx = new RegExp(`${webFriendlyImageFileTypes.join('$|')}$`, 'i');


export {
  ImageSequenceType,
  VideoType,

  videoFileTypes,
  webFriendlyImageFileTypes,
  imageFileTypes,

  videoFilesRegEx,
  imageFilesRegEx,
  webFriendlyImageRegEx,
};
