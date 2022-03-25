import { ref, Ref, computed } from '@vue/composition-api';
import IntervalTree from '@flatten-js/interval-tree';
import { cloneDeep } from 'lodash';
import Track, { TrackId } from '../track';

interface UseTrackStoreParams {
  markChangesPending: (
    {
      action,
      track,
      cameraName,
    }:
    {
      action: 'upsert' | 'delete';
      track: Track;
      cameraName: string;
    }) => void;
}

export interface InsertArgs {
  imported?: boolean;
  afterId?: TrackId;
  cameraName?: string;
}
/**
 * Retrieve a track from the base trackMap
 * If cameraName is 'any' we return the first track we find for basic usage
 */
export function getTrack(
  camMap: Readonly<Map<string, Map<TrackId, Track>>>, trackId: Readonly<TrackId>, cameraName = 'singleCam',
): Track {
  const currentMap = camMap.get(cameraName);
  if (!currentMap) {
    throw new Error(`No camera Map with the camera name: ${cameraName}`);
  }
  const tempTrack = currentMap?.get(trackId);
  if (!tempTrack) {
    throw new Error(`TrackId ${trackId} not found in trackMap with cameraName ${cameraName}`);
  }
  return tempTrack;
}

/**
 * Retrieve Possible Track from the trackMap, this is used for the case when returning undefined
 * is warranted for the consumer function to skip the action if the track doesn't exists or
 * handle it differently
 */
export function getPossibleTrack(
  camMap: Readonly<Map<string, Map<TrackId, Track>>>, trackId: Readonly<TrackId>, cameraName = 'singleCam',
): Track | undefined {
  try {
    return getTrack(camMap, trackId, cameraName);
  } catch (err) {
    return undefined;
  }
}

/**
 * Returns the first track it finds in any camera.  This is useful if we need global data
 * from any existing track like the track confidencePair or the trackId
 */
export function getAnyTrack(
  trackMap: Readonly<Map<string, Map<TrackId, Track>>>, trackId: Readonly<TrackId>,
) {
  let track: Track | undefined;
  trackMap.forEach((camera) => {
    const tempTrack = camera.get(trackId);
    if (tempTrack) {
      track = tempTrack;
    }
  });
  if (track) {
    return track;
  }
  throw new Error(`TrackId ${trackId} not found in any camera`);
}

/**
 * Used to return an array of overlapping trackIds amongst all cameras
 * This is used to set global information across tracks like ConfidencePairs
 * or Track Attributes
 */
export function getTrackAll(
  trackMap: Readonly<Map<string, Map<TrackId, Track>>>,
  trackId: Readonly<TrackId>,
):
  Track[] {
  const trackList: Track[] = [];
  trackMap.forEach((camera) => {
    const tempTrack = camera.get(trackId);
    if (tempTrack) {
      trackList.push(tempTrack);
    }
  });
  return trackList;
}

/**
 * Takes tracks from multiple cameras and merges them into a single track for use
 * in the event viewer for having the correct time bounds and keyframes for the
 * event viewer across cameras
 */
export function getTracksMerged(
  trackMap: Readonly<Map<string, Map<TrackId, Track>>>,
  trackId: Readonly<TrackId>,
): Track {
  if (trackMap.size === 1) {
    return getTrack(trackMap, trackId);
  }
  let track: Track | undefined;
  trackMap.forEach((camera) => {
    const tempTrack = camera.get(trackId);
    if (!track && tempTrack) {
      track = cloneDeep(tempTrack);
    } else if (track && tempTrack) {
      // Merge track bounds and data together
      // We don't care about feature data just that features are at X frame
      track.merge([tempTrack], true);
    }
  });
  if (!track) {
    throw Error(`TrackId: ${trackId} is not found in any camera`);
  }
  return track;
}


/**
 * TrackStore performs operations on a collection of tracks, such as
 * add and remove.  Operations on individual tracks, such as setting
 * and deleting detections, should be performed directly on the track
 * object.  Trackstore will observe these changes and react if necessary.
 */
export default function useTrackStore({ markChangesPending }: UseTrackStoreParams) {
  /* Non-reactive state
   *
   * camMap is provided for lookup by computed functions and templates.
   * Note that a track class instance must NEVER be returned in its entirety by
   * a computed function.
   */
  const camMap = new Map<string, Map<TrackId, Track>>();
  // Requires a camera for initialization before loading
  camMap.set('singleCam', new Map<TrackId, Track>());
  // internval Tree should be the same because all overlapping tracks have the same Id and length
  const intervalTree = new IntervalTree();

  /* Reactive state
   *
   * trackIds is a list of ID keys into trackMap.  Used to watch for add and remove
   * events that change the quantity of tracks
   *
   * canary is updated whenever a track being watched changes.  Used to watch for
   * update events on existing tracks.  If your computed function relies on a property
   * of a track, it must depend() on the canary.
   */
  const trackIds: Ref<Array<TrackId>> = ref([]);
  const canary = ref(0);

  function _depend(): number {
    return canary.value;
  }

  function getNewTrackId() {
    if (trackIds.value.length) {
      return trackIds.value.reduce((prev, current) => Math.max(prev, current)) + 1;
    }
    return 0;
  }
  function cameraOnChange(cameraName = 'singleCam') {
    return function onChange(
      { track, event, oldValue }:
    { track: Track; event: string; oldValue: unknown },
    ): void {
      if (event === 'bounds') {
        const oldInterval = oldValue as [number, number];
        intervalTree.remove(oldInterval, track.trackId.toString());
        intervalTree.insert([track.begin, track.end], track.trackId.toString());
      }
      canary.value += 1;
      markChangesPending({ cameraName, action: 'upsert', track });
    };
  }

  function addCamera(cameraName: string) {
    if (camMap.get(cameraName) === undefined) {
      camMap.set(cameraName, new Map<TrackId, Track>());
    }
  }

  function removeCamera(cameraName: string) {
    if (camMap.get(cameraName) !== undefined) {
      camMap.delete(cameraName);
    }
  }

  function insertTrack(track: Track, args?: InsertArgs) {
    const cameraName = args?.cameraName ?? 'singleCam';
    track.setNotifier(cameraOnChange(cameraName));
    if (camMap.get(cameraName) === undefined) {
      camMap.set(cameraName, new Map<TrackId, Track>());
    }
    const currentMap = camMap.get(cameraName);
    if (currentMap) {
      currentMap.set(track.trackId, track);
      intervalTree.insert([track.begin, track.end], track.trackId.toString());
      if (args && args.afterId) {
      /* Insert specifically after another trackId */
        const insertIndex = trackIds.value.indexOf(args.afterId) + 1;
        trackIds.value.splice(insertIndex, 0, track.trackId);
      } else if (trackIds.value.indexOf(track.trackId) === -1) {
        trackIds.value.push(track.trackId);
      }
      if (!args?.imported) {
        markChangesPending({ cameraName, action: 'upsert', track });
      }
    }
  }

  function addTrack(frame: number, defaultType: string,
    afterId?: TrackId, cameraName?: string, overrideTrackId?: number): Track {
    const camName = cameraName ?? 'singleCam';
    const newId = overrideTrackId ?? getNewTrackId();
    const track = new Track(newId, {
      begin: frame,
      end: frame,
      confidencePairs: [[defaultType, 1]],
    });
    insertTrack(track, { afterId: overrideTrackId ? undefined : afterId, cameraName: camName });
    markChangesPending({ cameraName: camName, action: 'upsert', track });
    return track;
  }

  /**
   * Removal of a track from the track
   * @param cameraName - if empty remove all tracks, if a camera name is specified
   * remove only that track
   */
  function removeTrack(trackId: TrackId | null, disableNotifications = false, cameraName = ''): void {
    if (trackId === null) {
      return;
    }
    let range: number[] = [];
    if (cameraName === '') {
      camMap.forEach((currentMap, currentCam) => {
        const track = currentMap.get(trackId);
        if (track) {
          range = [track.begin, track.end];
          track.setNotifier(undefined);
          currentMap.delete(trackId);
          if (!disableNotifications) {
            markChangesPending({ cameraName: currentCam, action: 'delete', track });
          }
        }
      });
    } else {
      const currentMap = camMap.get(cameraName);
      if (currentMap) {
        const track = currentMap.get(trackId);
        if (track) {
          range = [track.begin, track.end];
          track.setNotifier(undefined);
          currentMap.delete(trackId);
          if (!disableNotifications) {
            markChangesPending({ cameraName, action: 'delete', track });
          }
        }
      }
      // We need to update the range if there are other Tracks Left.
      if (getPossibleTrack(camMap, trackId)) {
        const remainingTracks = getTracksMerged(camMap, trackId);
        intervalTree.insert([remainingTracks.begin, remainingTracks.end], trackId.toString());
        // Exit function to prevent removal of range
        return;
      }
    }
    //Interval and Index are removed only once
    if (range.length) {
      if (!intervalTree.remove(range, trackId.toString())) {
        throw new Error(`TrackId ${trackId} with range ${range} not found in tree.`);
      }
      const listIndex = trackIds.value.findIndex((v) => v === trackId);
      if (listIndex === -1) {
        throw new Error(`TrackId ${trackId} not found in trackIds.`);
      }
      trackIds.value.splice(listIndex, 1);
    }
  }

  function clearAllTracks() {
    camMap.forEach((currentMap) => {
      if (currentMap) {
        currentMap.clear();
      }
    });
    intervalTree.items.forEach((item) => {
      intervalTree.remove(item.key);
    });
    trackIds.value = [];
  }


  const sortedTracks = computed(() => {
    _depend();
    return trackIds.value
      .map((trackId) => getTracksMerged(camMap, trackId))
      .sort((a, b) => a.begin - b.begin);
  });

  return {
    camMap,
    sortedTracks,
    intervalTree,
    addTrack,
    addCamera,
    removeCamera,
    insertTrack,
    getNewTrackId,
    removeTrack,
    clearAllTracks,
  };
}
