import { ref, Ref, computed } from '@vue/composition-api';
import { getDetections } from '@/lib/api/viameDetection.service';
import Track, { TrackId } from '@/lib/track';
import IntervalTree from '@flatten-js/interval-tree';

interface UseTrackStoreParams {
  markChangesPending: () => void;
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
   * a computed function.  The consumer of this composition function will probably
   * want to `provide()` the trackMap to all children instead of passing it through
   * the template.
   *
   * Note that composition api has `shallowRef` and `shallowReactive`, which might
   * allow trackIds and trackMap to be combined into 1 object with the same reactivity
   * goals.  They were separated to avoid any mental gymnastics and situations where
   * the reactivity behavior is suprising to a future developer.
   * See also: https://composition-api.vuejs.org/api.html#shallowreactive
   *
   * RangeList is a TODO for fast lookups
   */
  const trackMap = new Map<TrackId, Track>();
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

  function onChange(
    { track, event, oldValue }:
    { track: Track; event: string; oldValue: unknown },
  ): void {
    if (event === 'bounds') {
      const oldInterval = oldValue as [number, number];
      intervalTree.remove(oldInterval, track.trackId);
      intervalTree.insert([track.begin, track.end], track.trackId);
    }
    canary.value += 1;
    markChangesPending();
  }

  function insertTrack(track: Track) {
    track.$on('notify', onChange);
    trackMap.set(track.trackId, track);
    intervalTree.insert([track.begin, track.end], track.trackId);
    trackIds.value.push(track.trackId);
  }

  function addTrack(frame: number): Track {
    const newTrackId = trackIds.value.length
      ? Math.max(...trackIds.value) + 1
      : 0;
    const track = new Track(newTrackId, {
      begin: frame,
      end: frame,
      confidencePairs: [['unknown', 1]],
    });
    insertTrack(track);
    markChangesPending();
    return track;
  }

  function removeTrack(trackId: TrackId): void {
    if (trackId === null) {
      return;
    }
    const track = trackMap.get(trackId);
    if (track === undefined) {
      throw new Error(`TrackId ${trackId} not found in trackMap.`);
    }
    const range = [track.begin, track.end];
    if (!intervalTree.remove(range, trackId)) {
      throw new Error(`TrackId ${trackId} with range ${range} not found in tree.`);
    }
    track.$off(); // remove all event listeners
    trackMap.delete(trackId);
    const listIndex = trackIds.value.findIndex((v) => v === trackId);
    if (listIndex === -1) {
      throw new Error(`TrackId ${trackId} not found in trackIds.`);
    }
    trackIds.value.splice(listIndex, 1);
    markChangesPending();
  }

  async function splitTracks() {
    // TODO p2
    return null;
  }

  async function loadTracks(datasetFolderId: string) {
    const data = await getDetections(datasetFolderId, 'track_json');
    if (data !== null) {
      Object.values(data).forEach(
        (trackData) => insertTrack(Track.fromJSON(trackData)),
      );
    }
  }

  const sortedTrackIds = computed(() => {
    _depend();
    return trackIds.value.sort((a, b) => {
      const trackA = trackMap.get(a);
      const trackB = trackMap.get(b);
      if (trackA === undefined || trackB === undefined) {
        throw new Error(`Found trackIds not in track map: ${a}, ${b}`);
      }
      return trackA.begin - trackB.begin;
    });
  });

  return {
    trackMap,
    sortedTrackIds,
    intervalTree,
    addTrack,
    removeTrack,
    splitTracks,
    loadTracks,
  };
}
