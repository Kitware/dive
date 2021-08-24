
import { MultiTrackRecord } from 'dive-common/apispec';
import fs from 'fs-extra';
import { AnnotationFileData } from 'platform/desktop/backend/serializers/viame';


import {
  TrackData, Feature, StringKeyObject,
} from 'vue-media-annotator/track';
import { RectBounds } from 'vue-media-annotator/utils';


interface TrackJSON {
  begin: number;
  end: number;
  trackId: number;
  meta: StringKeyObject;
  attributes: StringKeyObject;
  confidencePairs: [string, number][];
  features: Feature[];

}

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

export interface NistFile {
    filesProcessed: string[];
    processingReport: {
        fileStatuses: Record<string, {
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
  return Array.isArray(data.activities) && Array.isArray(data.filesProcessed);
}

async function confirmNistFile(filename: string) {
  const rawBuffer = await fs.readFile(filename, 'utf-8');
  let nistFile: NistFile;
  if (rawBuffer.length === 0) {
    return false;
  }
  try {
    nistFile = JSON.parse(rawBuffer) as NistFile;
  } catch (err) {
    throw new Error(`Unable to parse ${filename}: ${err}`);
  }
  return confirmNistFormat(nistFile);
}

function loadObjects(
  objects: NistObject[],
  baseFileName: string,
  activity: NistActivity,
  trackCount: number,
): TrackJSON[] {
  const tracks: TrackJSON[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    const object = objects[i];
    const { localization, objectID, objectType } = object;
    let count = 1;
    Object.entries(localization).forEach(([key, annotations]) => {
      if (key === baseFileName) {
        const track: TrackJSON = {
          begin: Infinity,
          end: -Infinity,
          trackId: trackCount + count,
          meta: {},
          attributes: {
            activity: activity.activity,
            activityID: activity.activityID,
            isObject: true,
            objectType,
            objectID,
          },
          confidencePairs: [[objectType, activity.presenceConf]],
          features: [],
        };
        count += 1;
        Object.entries(annotations).forEach(([frame, bounds]) => {
          if (bounds.boundingBox !== undefined) { // End frame if no bounds
            const bbox = bounds.boundingBox;
            const adjustedBounds: RectBounds = [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h];
            const frameNum = parseInt(frame, 10) - 1;
            track.end = Math.max(track.end, frameNum);
            track.begin = Math.min(track.begin, frameNum);
            track.features.push({
              frame: frameNum,
              keyframe: true,
              bounds: adjustedBounds,
              attributes: {
                objectID,
                objectType,
              },
            });
          }
        });
        tracks.push(track);
      }
    });
  }
  // Create a track based on the features

  return tracks;
}

function loadActivity(
  activity: NistActivity,
  baseFileName: string,
  fullFrameBounds: RectBounds = [0, 0, 1920, 1080],
  currentLength: number,
  activityPos: number,
): TrackData[] {
  const tracks: TrackJSON[] = [];
  Object.entries(activity.localization).forEach(([key, localization]) => {
    if (baseFileName === key) {
      let trackId = activity.activityID;
      if (trackId < tracks.length + currentLength) {
        trackId = tracks.length + currentLength + 1;
      }
      const track: TrackJSON = {
        begin: Infinity,
        end: -Infinity,
        trackId,
        meta: {},
        attributes: {},
        confidencePairs: [[activity.activity, activity.presenceConf]],
        features: [],
      };
      const features: Feature[] = [];
      // Now we determine frame numbers
      const lineHeight = 30;
      const lineWidth = 40;
      const frameHeight = fullFrameBounds[3];
      const bounds: RectBounds = [0, 0, 0, 0];
      const maxActivitiesPerCol = Math.floor(frameHeight / lineHeight);
      let rowPos = 0;
      if (activityPos < maxActivitiesPerCol) {
        rowPos = Math.floor(activityPos / maxActivitiesPerCol);
      }
      bounds[0] = rowPos * lineWidth;
      bounds[1] = (activityPos - (rowPos * maxActivitiesPerCol)) * lineHeight;
      bounds[2] = bounds[0] + 1;
      bounds[3] = bounds[1] + 1;
      Object.entries(localization).forEach(([frame, val]) => {
        if (val === 0) {
          track.begin = parseInt(key, 10) - 1;
          features.push({
            frame: parseInt(frame, 10) - 1,
            bounds,
            keyframe: true,
            interpolate: false,
          });
        } else if (val === 1) {
          track.end = parseInt(key, 10) - 1;
          features.push({
            frame: parseInt(frame, 10) - 1,
            bounds,
            keyframe: true,
            interpolate: true,
          });
        }
      });
      const { alertFrame } = activity;
      track.attributes = {
        activityID: activity.activityID,
        isActivity: true,
      };
      if (alertFrame) {
        track.attributes.alertFrame = alertFrame - 1;
      }
      // Make sure features is in the right order:
      features.sort((a, b) => a.frame - b.frame);
      // Filter out duplicates between Activity and Objects
      track.begin = features[0].frame;
      track.end = features[features.length - 1].frame;
      track.features = features;
      tracks.push(track);

      //Need to add in any objectIDs if they exist
      if (activity.objects) {
        const objectTracks = loadObjects(activity.objects, baseFileName, activity, trackId);
        objectTracks.forEach((objectTrack) => {
          tracks.push(objectTrack);
        });
      }
    }
  });
  return tracks;
}

function convertNisttoJSON(
  nistFile: NistFile,
  filename: string,
  fullFrameBounds: RectBounds = [0, 0, 1920, 1080],
) {
  const activityTypePos: Record<string, number> = {};
  let uniqueActivities = 0;
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
  let trackData: TrackData[] = [];
  const { activities } = nistFile;
  for (let i = 0; i < activities.length; i += 1) {
    const activity = activities[i];
    if (activityTypePos[activity.activity] === undefined) {
      activityTypePos[activity.activity] = uniqueActivities;
      uniqueActivities += 1;
    }
    const tracks = loadActivity(activity, baseFilename, fullFrameBounds,
      trackData.length, activityTypePos[activity.activity]);
    if (tracks) {
      trackData = trackData.concat(tracks);
    }
  }
  return {
    tracks: trackData,
  };
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
  return convertNisttoJSON(nistFile, filename, fullFrameBounds);
}

function createObject(
  track: TrackData,
  filename: string,
): NistObject {
  const localization: ObjectLocalization = {};
  localization[filename] = {};
  const { features } = track;
  let objectID = track.attributes.objectID as number;
  let objectType = track.attributes.objectType as string;
  features.forEach((feature) => {
    if (feature.bounds) {
      const bbox = feature.bounds;
      localization[filename][(feature.frame + 1).toString()] = {
        boundingBox: {
          x: bbox[0],
          y: bbox[1],
          w: bbox[2] - bbox[0],
          h: bbox[3] - bbox[1],
        },
      };
      if (feature.attributes?.objectID) {
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
  const activityID = track.attributes.activityID as number;
  const activity = track.confidencePairs[0][0];
  const presenceConf = track.confidencePairs[0][1];
  const alertFrame = track.begin + 1;
  // If all features are full frame there are no objects
  const localization: ActivityLocalization = {};
  localization[filename] = {};
  localization[filename][(track.begin + 1).toString()] = 1;
  localization[filename][(track.end + 1).toString()] = 0;
  const objects: NistObject[] = [];
  // Need to pick up any gabs in the time if there are multiple 1-0 pairs
  if (track.features.length % 2 === 0) { //This can only be true if there is an even number
    const offFrames = track.features.filter((feature) => !feature.interpolate);
    const onFrames = track.features.filter((feature) => feature.interpolate);
    if (offFrames.length > 0) {
      offFrames.forEach((feature) => {
        if (feature.frame !== track.end && feature.frame !== track.begin) {
          localization[filename][(feature.frame + 1).toString()] = 0;
        }
      });
      onFrames.forEach((feature) => {
        if (feature.frame !== track.end && feature.frame !== track.begin) {
          localization[filename][(feature.frame + 1).toString()] = 1;
        }
      });
    }
  }
  const nistActivity: NistActivity = {
    activityID,
    presenceConf,
    activity,
    alertFrame,
    localization,
  };
  nistActivity.objects = objects;
  return nistActivity;
}

async function exportNist(
  trackData: MultiTrackRecord,
  videoFileName: string,
) {
  const status: Record<string, {status: 'success' | 'fail'; message: string}> = {};
  status[videoFileName] = {
    status: 'success',
    message: 'exported from DIVE',
  };
  const nistFile: NistFile = {
    filesProcessed: [videoFileName],
    processingReport: {
      fileStatuses: status,
    },
    activities: [],
  };
  const activitiesMap: Record<string, NistActivity> = {};
  Object.values(trackData).forEach((track) => {
    if (track.attributes.isActivity && track.attributes.activityID !== undefined) {
      activitiesMap[track.attributes.activityID as number] = createActivity(track, videoFileName);
    }
  });
  Object.values(trackData).forEach((track) => {
    if (track.attributes.isObject && track.attributes.activityID !== undefined) {
      const currrentActivity = activitiesMap[track.attributes.activityID as number];
      if (!currrentActivity.objects) {
        currrentActivity.objects = [];
      }
      currrentActivity.objects.push(createObject(track, videoFileName));
    }
  });

  nistFile.activities = Object.values(activitiesMap);
  return nistFile;
}

export {
  loadNistFile,
  convertNisttoJSON,
  exportNist,
  confirmNistFormat,
  confirmNistFile,
};
