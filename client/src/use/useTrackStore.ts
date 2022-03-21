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

interface InsertArgs {
  imported?: boolean;
  afterId?: TrackId;
  cameraName?: string;
}
/**
 * Retrieve a track from the base trackMap
 * If cameraName is 'any' we return the first track we find for basic usage
 */
export function getTrack(
  trackMap: Readonly<Map<string, Map<TrackId, Track>>>, trackId: Readonly<TrackId>, cameraName = 'any',
): Track {
  let track: Track | undefined;
  if (cameraName === 'any') {
    trackMap.forEach((camera) => {
      const tempTrack = camera.get(trackId);
      if (tempTrack) {
        track = tempTrack;
      }
    });
    if (track) {
      return track;
    }
  }
  const currentMap = trackMap.get(cameraName);
  const tempTrack = currentMap?.get(trackId);
  if (tempTrack) {
    return tempTrack;
  }
  throw new Error(`TrackId ${trackId} not found in trackMap with cameraName ${cameraName}`);
}

/**
 * Used to return an array of overlapping trackIds amongst all cameras
 * This is used to set global information across tracks like ConfidencePairs
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
      track.merge([tempTrack]);
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
   * TrackMap is provided for lookup by computed functions and templates.
   * Note that a track class instance must NEVER be returned in its entirety by
   * a computed function.
   */
  const trackMap = new Map<string, Map<TrackId, Track>>();
  trackMap.set('default', new Map<TrackId, Track>());
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

  // Multi-Camera Support
  // internval Tree should be the same because all overlapping tracks have the same Id and length

  function _depend(): number {
    return canary.value;
  }

  function getNewTrackId() {
    if (trackIds.value.length) {
      return trackIds.value.reduce((prev, current) => Math.max(prev, current)) + 1;
    }
    return 0;
  }
  function cameraOnChange(cameraName = 'default') {
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
    if (trackMap.get(cameraName) === undefined) {
      trackMap.set(cameraName, new Map<TrackId, Track>());
    }
  }


  function insertTrack(track: Track, args?: InsertArgs) {
    const cameraName = args?.cameraName ?? 'default';
    track.setNotifier(cameraOnChange(cameraName));
    if (trackMap.get(cameraName) === undefined) {
      trackMap.set(cameraName, new Map<TrackId, Track>());
    }
    const currentMap = trackMap.get(cameraName);
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
    const camName = cameraName ?? 'default';
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

  function removeTrack(trackId: TrackId | null, disableNotifications = false, cameraName = 'all'): void {
    if (trackId === null) {
      return;
    }
    let range: number[] = [];
    if (cameraName === 'all') {
      trackMap.forEach((currentMap, currentCam) => {
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
      const currentMap = trackMap.get(cameraName);
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
    trackMap.forEach((currentMap) => {
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
      .map((trackId) => getTracksMerged(trackMap, trackId))
      .sort((a, b) => a.begin - b.begin);
  });

  return {
    trackMap,
    sortedTracks,
    intervalTree,
    addTrack,
    addCamera,
    insertTrack,
    getNewTrackId,
    removeTrack,
    clearAllTracks,
  };
}
