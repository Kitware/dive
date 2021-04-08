import npath from 'path';
import fs from 'fs-extra';
import {
  DatasetType, FrameImage,
} from 'dive-common/apispec';

import { JsonMeta } from 'platform/desktop/constants';

function transcodeMultiCam(
  jsonMeta: JsonMeta,
  item: string,
  projectDirAbsPath: string,
  datasetType: DatasetType,
  extension: '.mp4' | '.png',
) {
  let destLoc = '';
  if (jsonMeta.multiCam) {
    Object.entries(jsonMeta.multiCam.cameras).forEach(([key, val]) => {
      if (item.includes(val.basePath)) {
        destLoc = item.replace(val.basePath, projectDirAbsPath);
        destLoc = destLoc.replace(npath.basename(item), `${key}_${npath.basename(item)}`);
        destLoc = destLoc.replace(npath.extname(item), extension);

        if (datasetType === 'image-sequence') {
          if (!val.transcodedImagesFiles) {
            // eslint-disable-next-line no-param-reassign
            val.transcodedImagesFiles = [];
          }
          val.transcodedImagesFiles.push(npath.basename(destLoc));
        } else if (datasetType === 'video') {
          // eslint-disable-next-line no-param-reassign
          val.transcodedVideo = npath.basename(destLoc);
        }
      }
    });
  }
  return destLoc;
}

function writeMultiCamPipelineInputs(jobWorkDir: string, meta: JsonMeta) {
  const InputArgFilePair: Record<string, string> = {};
  if (meta.type === 'image-sequence' || meta.type === 'video') {
    if (meta.multiCam && meta.multiCam.cameras) {
      let i = 0;
      Object.values(meta.multiCam.cameras).forEach((list) => {
        const { basePath } = list;
        const fileName = `cam${i + 1}_images.txt`; //This is locked in the pipeline for now
        const inputArg = `cam${i + 2}_iread`; // lock for the stereo pipeline as well
        InputArgFilePair[inputArg] = fileName;
        const inputFile = fs.createWriteStream(npath.join(jobWorkDir, fileName));
        list.filenames.forEach((image) => inputFile.write(`${npath.join(basePath, image)}\n`));
        inputFile.end();
        i += 1;
      });
    }
  }
  return InputArgFilePair;
}

function getMultiCamUrls(
  projectMetaData: JsonMeta,
  projectBasePath: string,
  makeMediaUrl: (path: string) => string,
) {
  let imageData = [] as FrameImage[];
  let videoUrl = '';
  if (projectMetaData.multiCam && projectMetaData.multiCam.display) {
    //Confirm we have a imageList for the display
    const displayImageList = projectMetaData.multiCam.cameras[projectMetaData.multiCam.display];
    if (!displayImageList) {
      throw new Error(`The default display of ${projectMetaData.multiCam.display} is not in the list of cameras`);
    }
    if (projectMetaData.type === 'image-sequence') {
      let displayFilenames = displayImageList.filenames;
      let { basePath } = displayImageList;
      // Filter transcoded images to use left/right files)
      if (displayImageList.transcodedImagesFiles && displayImageList.transcodedImagesFiles.length) {
        displayFilenames = displayImageList.transcodedImagesFiles;
        basePath = projectBasePath;
      }
      imageData = displayFilenames.map((filename: string) => ({
        url: makeMediaUrl(npath.join(basePath, filename)),
        filename,
      }));
    } else if (projectMetaData.type === 'video') {
      let displayFilename = displayImageList.videoFile;
      let { basePath } = displayImageList;
      if (displayImageList.transcodedVideo) {
        displayFilename = `${displayImageList.transcodedVideo}`;
        basePath = projectBasePath;
      }
      videoUrl = makeMediaUrl(npath.join(basePath, displayFilename));
    }
  } else {
    throw new Error('There is no default display for the multicam dataset');
  }
  return {
    imageData,
    videoUrl,
  };
}

function getMultiCamVideoPath(meta: JsonMeta) {
  if (meta.multiCam && meta.multiCam.display) {
    if (meta.multiCam.cameras[meta.multiCam.display]) {
      const display = meta.multiCam.cameras[meta.multiCam.display];
      if (display.transcodedVideo) {
        return display.transcodedVideo;
      }
      return display.videoFile;
    }
    throw new Error(`No video exists for the display file of ${meta.multiCam.display}`);
  }
  throw new Error(`${meta.id} does not contain multiCam data`);
}

function getMultiCamImageFiles(meta: JsonMeta) {
  if (meta.multiCam && meta.multiCam.display) {
    if (meta.multiCam.cameras[meta.multiCam.display]) {
      const display = meta.multiCam.cameras[meta.multiCam.display];
      return display.filenames;
    }
    throw new Error(`No Image list exists for the display file of ${meta.multiCam.display}`);
  }
  throw new Error(`${meta.id} does not contain multiCam data`);
}

export {
  transcodeMultiCam,
  writeMultiCamPipelineInputs,
  getMultiCamVideoPath,
  getMultiCamImageFiles,
  getMultiCamUrls,
};
