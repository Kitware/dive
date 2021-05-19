import npath from 'path';
import fs from 'fs-extra';
import {
  DatasetType,
  FrameImage,
} from 'dive-common/apispec';

import { JsonMeta } from 'platform/desktop/constants';

function transcodeMultiCam(
  jsonMeta: JsonMeta,
  item: string,
  projectDirAbsPath: string,
) {
  let destLoc = '';
  if (jsonMeta.multiCam) {
    Object.entries(jsonMeta.multiCam.cameras).forEach(([key, val]) => {
      if (item.includes(val.originalBasePath)) {
        destLoc = item.replace(val.originalBasePath, projectDirAbsPath);
        destLoc = destLoc.replace(npath.basename(item), `${key}_${npath.basename(item)}`);
        const extension = val.type === 'video' ? '.mp4' : '.png';
        destLoc = destLoc.replace(npath.extname(item), extension);

        if (val.type === 'image-sequence') {
          if (!val.transcodedImagesFiles) {
            // eslint-disable-next-line no-param-reassign
            val.transcodedImagesFiles = [];
          }
          val.transcodedImagesFiles.push(npath.basename(destLoc));
        } else if (val.type === 'video') {
          // eslint-disable-next-line no-param-reassign
          val.transcodedVideoFile = npath.basename(destLoc);
        }
      }
    });
  }
  return destLoc;
}

function getTranscodedMultiCamType(imageListFile: string, jsonMeta: JsonMeta) {
  // Look through cameras trying to find the match for the key/name and type to return back the type
  if (jsonMeta.multiCam) {
    const keys = Object.keys(jsonMeta.multiCam.cameras);
    const split = npath.basename(imageListFile).split('_');
    if (split.length && keys.includes(split[0])) {
      return jsonMeta.multiCam.cameras[split[0]] && jsonMeta.multiCam.cameras[split[0]].type;
    }
  }
  throw new Error(`No associate type for ${imageListFile} in multiCam data`);
}

function writeMultiCamPipelineInputs(jobWorkDir: string, meta: JsonMeta) {
  const InputArgFilePair: Record<string, string> = {};
  if (meta.multiCam && meta.multiCam.cameras) {
    let i = 0;
    Object.values(meta.multiCam.cameras).forEach((list) => {
      const { originalBasePath } = list;
      const fileName = `cam${i + 1}_images.txt`; //This is locked in the pipeline for now
      const inputArg = `cam${i + 1}_imread`; // lock for the stereo pipeline as well
      InputArgFilePair[inputArg] = fileName;
      const inputFile = fs.createWriteStream(npath.join(jobWorkDir, fileName));
      list.originalImageFiles.forEach((image) => inputFile.write(`${npath.join(originalBasePath, image)}\n`));
      inputFile.end();
      i += 1;
    });
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
  let type: DatasetType = 'image-sequence';
  if (projectMetaData.multiCam && projectMetaData.multiCam.display) {
    //Confirm we have a imageList for the display
    const displayCamera = projectMetaData.multiCam.cameras[projectMetaData.multiCam.display];
    if (!displayCamera) {
      throw new Error(`The default display of ${projectMetaData.multiCam.display} is not in the list of cameras`);
    }
    if (displayCamera.type === 'image-sequence') {
      let displayFilenames = displayCamera.originalImageFiles;
      let { originalBasePath } = displayCamera;
      // Filter transcoded images to use left/right files)
      if (displayCamera.transcodedImagesFiles && displayCamera.transcodedImagesFiles.length) {
        displayFilenames = displayCamera.transcodedImagesFiles;
        originalBasePath = projectBasePath;
      }
      imageData = displayFilenames.map((filename: string) => ({
        url: makeMediaUrl(npath.join(originalBasePath, filename)),
        filename,
      }));
    } else if (displayCamera.type === 'video') {
      let displayFilename = displayCamera.originalVideoFile;
      let { originalBasePath } = displayCamera;
      if (displayCamera.transcodedVideoFile) {
        displayFilename = `${displayCamera.transcodedVideoFile}`;
        originalBasePath = projectBasePath;
      }
      videoUrl = makeMediaUrl(npath.join(originalBasePath, displayFilename));
    }
    type = displayCamera.type;
  } else {
    throw new Error('There is no default display for the multicam dataset');
  }
  return {
    imageData,
    videoUrl,
    type,
  };
}

function getMultiCamVideoPath(meta: JsonMeta) {
  if (meta.multiCam && meta.multiCam.display) {
    if (meta.multiCam.cameras[meta.multiCam.display]) {
      const display = meta.multiCam.cameras[meta.multiCam.display];
      if (display.transcodedVideoFile) {
        return display.transcodedVideoFile;
      }
      return display.originalVideoFile;
    }
    throw new Error(`No video exists for the display file of ${meta.multiCam.display}`);
  }
  throw new Error(`${meta.id} does not contain multiCam data`);
}

function getMultiCamImageFiles(meta: JsonMeta) {
  if (meta.multiCam && meta.multiCam.display) {
    if (meta.multiCam.cameras[meta.multiCam.display]) {
      const display = meta.multiCam.cameras[meta.multiCam.display];
      return display.originalImageFiles;
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
  getTranscodedMultiCamType,
};
