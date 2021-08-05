
import { MultiTrackRecord } from 'dive-common/apispec';
import fs from 'fs-extra';
import { AnnotationFileData } from 'platform/desktop/backend/serializers/viame';


import Track, {
  TrackData, Feature, StringKeyObject,
} from 'vue-media-annotator/track';
import { RectBounds } from 'vue-media-annotator/utils';

type ActivityLocalization = Record<string, Record<string, number>>;
// { filename: '123':0, '234':1} object with key equal to
// filename and two number key with one equal to 0 and other 1
type ObjectLocalization = Record<string,
    Record<string,
        Record<'boundingBox', {
            x: number;
            y: number;
            w: number;
            h: number;
        }>
    >
>;

interface NistFile {
    filesProcessed: string[];
    processingReport: {
        filesStatuses: Record<string, {
            status: 'success' | 'fail';
            message: string;
        }>;
        siteSpecific?: StringKeyObject;
    };
    activities: NistActivity[];

}
interface NistObject {
    objectType: string;
    objectID: number;
    localization: ObjectLocalization;
}

interface NistActivity {
    presenceConf: number;
    alertFrame?: number;
    activity: string;
    localization: ActivityLocalization;
    activityID: number;
    objects?: NistObject[];
}


function confirmNistFormat(data: NistFile) {
  return data.activities && data.filesProcessed && data.processingReport;
}

function loadObjects(objects: NistObject[], baseFileName: string): Feature[] {
  const features: Feature[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    const object = objects[i];
    const { localization, objectID, objectType } = object;
    Object.entries(localization).forEach(([key, annotations]) => {
      if (key === baseFileName) {
        Object.entries(annotations).forEach(([frame, bounds]) => {
          const bbox = bounds.boundingBox;
          const adjustedBounds: RectBounds = [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h];
          features.push({
            frame: parseInt(frame, 10),
            keyframe: true,
            bounds: adjustedBounds,
            attributes: {
              objectID,
              objectType,
            },
          });
        });
      }
    });
  }
  return features;
}

function loadActivity(
  activity: NistActivity,
  baseFileName: string,
  fullFrameBounds: RectBounds = [0, 0, 1920, 1080],
): TrackData | null {
  const tracks = Object.entries(activity.localization).map(([key, localization]) => {
    if (baseFileName === key) {
      const track = new Track(activity.activityID,
        { confidencePairs: [[activity.activity, activity.presenceConf]] });
      let features: Feature[] = [];
      // Now we determine fram numbers
      Object.entries(localization).forEach(([frame, val]) => {
        if (val === 0) {
          track.begin = parseInt(key, 10) - 1;
          features.push({
            frame: parseInt(frame, 10) - 1,
            bounds: fullFrameBounds,
            keyframe: true,
          });
        } else if (val === 1) {
          track.end = parseInt(key, 10) - 1;
          features.push({
            frame: parseInt(frame, 10) - 1,
            bounds: fullFrameBounds,
            keyframe: true,
            interpolate: true,
          });
        }
      });
      const { alertFrame } = activity;
      track.attributes = {
        alertFrame,
      };
      //Need to add in any objectIds if they exist
      if (activity.objects) {
        features = features.concat(loadObjects(activity.objects, baseFileName));
      }
      // Make sure features is in the right order:
      features.sort((a, b) => a.frame - b.frame);
      track.begin = features[0].frame;
      track.end = features[features.length - 1].frame;
      track.features = features;
      return track;
    }
    return null;
  });
  if (tracks.length === 1 && tracks[0] !== null) {
    return tracks[0];
  }
  return null;
}

async function loadNistFile(
  filename: string,
  fullFrameBounds: RectBounds = [0, 0, 1920, 1080],
): Promise<AnnotationFileData> {
  let nistFile: NistFile;
  const rawBuffer = await fs.readFile(filename, 'utf-8');
  if (rawBuffer.length === 0) {
    return { tracks: [] }; // Return empty object if file was empty
  }
  try {
    nistFile = JSON.parse(rawBuffer) as NistFile;
  } catch (err) {
    throw new Error(`Unable to parse ${filename}: ${err}`);
  }
  if (!confirmNistFormat(nistFile)) {
    throw new Error(`Unable to confirm ${filename} is a Nist File`);
  }
  if (nistFile.filesProcessed.length > 1) {
    throw new Error(`Nist File ${filename} includes multiple files: ${nistFile.filesProcessed.join(',')}`);
  }
  if (nistFile.filesProcessed.length === 0) {
    return { tracks: [] }; // Return empty object if file was empty
  }
  const baseFilename = nistFile.filesProcessed[0];
  // Now lets process the activities to make sure they are correct
  const trackData: TrackData[] = [];
  const { activities } = nistFile;
  for (let i = 0; i < activities.length; i += 1) {
    const activity = activities[i];
    const track = loadActivity(activity, baseFilename, fullFrameBounds);
    if (track) {
      trackData.push(track);
    }
  }
  return {
    tracks: trackData,
  };
}

function createObject(features: Feature[], filename: string) {
  const localization: ObjectLocalization = {};
  localization[filename] = {};
  let objectID = 0;
  let objectType = '';
  features.forEach((feature) => {
    if (feature.bounds) {
      const bbox = feature.bounds;
      localization[filename][feature.frame.toString()] = {
        boundingBox: {
          x: bbox[0],
          y: bbox[1],
          w: bbox[2] - bbox[0],
          h: bbox[3] - bbox[1],
        },
      };
      if (feature.attributes?.objectId) {
        objectID = feature.attributes.objectID as number;
      }
      if (feature.attributes?.objectType) {
        objectType = feature.attributes.objectType as string;
      }
    }
  });
  return { objectID, objectType, localization };
}

function createActivity(
  track: TrackData,
  filename: string,
) {
  const activityID = track.trackId;
  const activity = track.confidencePairs[0][0];
  const presenceConf = track.confidencePairs[0][1];
  const alertFrame = track.begin;
  // If all features are full frame there are no objects
  const { features } = track;
  const localization: ActivityLocalization = {};
  localization[filename] = {};
  localization[filename][track.begin.toString()] = 1;
  localization[filename][track.end.toString()] = 0;
  //Any other times are considered objects and should be transferred into objects.
  const objects: NistObject[] = [];
  if (features.length > 2) {
    const featureList = features.filter(
      (feature) => feature.frame !== track.begin && feature.frame !== track.end,
    );
    objects.push(createObject(featureList, filename));
  }
  const nistActivity: NistActivity = {
    activityID,
    presenceConf,
    activity,
    alertFrame,
    localization,
  };
  if (objects) {
    nistActivity.objects = objects;
  }
  return nistActivity;
}

async function exportNist(trackData: MultiTrackRecord, videoFileName: string) {
  const status: Record<string, {status: 'success' | 'fail'; message: string}> = {};
  status[videoFileName] = {
    status: 'success',
    message: 'exported from DIVE',
  };
  const nistFile: NistFile = {
    filesProcessed: [videoFileName],
    processingReport: {
      filesStatuses: status,
    },
    activities: [],
  };
  const activities: NistActivity[] = [];
  Object.values(trackData).forEach((track) => {
    activities.push(createActivity(track, videoFileName));
  });
  nistFile.activities = activities;
  return nistFile;
}


export {
  loadNistFile,
  exportNist,
  confirmNistFormat,
};
