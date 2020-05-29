import { ref, Ref, computed } from '@vue/composition-api';
import { getDetections } from '@/lib/api/viameDetection.service';
import Track, { TrackData, TrackId } from '@/lib/track';
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
   * trackIds is a list of ID keys into trackMap.  When a reactive list of tracks
   * is needed, a list of string track IDs and a non-reactive reference to trackMap
   * should be used.
   */
  const trackIds: Ref<Array<TrackId>> = ref([]);

  function onChange(_t: Track): void {
    // TODO p1 update interval tree
    markChangesPending();
  }

  function addTrack(frame: number): Track {
    return new Track(Math.max(...trackIds.value) + 1, {
      begin: frame,
      end: frame,
    });
  }

  function removeTrack(trackId: TrackId): void {
    const track = trackMap.get(trackId);
    if (track === undefined) {
      throw new Error(`TrackId ${trackId} not found in trackMap.`);
    }
    const range = [track.begin.value, track.end.value];
    if (!intervalTree.remove(range, trackId)) {
      throw new Error(`TrackId ${trackId} with range ${range} not found in tree.`);
    }
    trackMap.delete(trackId);
    const listIndex = trackIds.value.findIndex((v) => v === trackId);
    if (listIndex === -1) {
      throw new Error(`TrackId ${trackId} not found in trackIds.`);
    }
    trackIds.value.splice(listIndex, 1);
  }

  async function splitTracks() {
    // TODO p2
    return null;
  }

  async function loadTracks(datasetFolderId: string) {
    const data = await getDetections(datasetFolderId, 'track_json');
    Object.entries(data).forEach(([trackId, value]) => {
      const track = Track.fromJSON(value as TrackData);
      const intTrackId = parseInt(trackId, 10);
      track.observers.push(onChange);
      trackMap.set(intTrackId, track);
      trackIds.value.push(intTrackId);
      intervalTree.insert([track.begin.value, track.end.value], intTrackId);
    });
  }

  const sortedTrackIds = computed(() => trackIds.value.sort((a, b) => {
    const trackA = trackMap.get(a);
    const trackB = trackMap.get(b);
    if (trackA === undefined || trackB === undefined) {
      throw new Error(`Found trackIds not in track map: ${a}, ${b}`);
    }
    return trackA.begin.value - trackB.begin.value;
  }));

  return {
    trackMap,
    sortedTrackIds,
    addTrack,
    removeTrack,
    splitTracks,
    loadTracks,
  };
}
