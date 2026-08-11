import {
  ComputedRef, Ref, computed, shallowRef, triggerRef,
} from 'vue';
import { cloneDeep, uniq } from 'lodash';
import {
  acceptPairAsCorrect,
  compileHierarchy,
  mergePairs,
  reassignPairs,
  removePair,
  setPairConfidence,
  TypeHierarchyIndex,
} from 'dive-common/typeHierarchy';
import Track from './track';
import type Group from './Group';
import { AnnotationId, ConfidencePair } from './BaseAnnotation';
import { MarkChangesPending, SortedAnnotation } from './BaseAnnotationStore';
import GroupStore from './GroupStore';
import TrackStore from './TrackStore';
import { createTrackProjection, TrackProjection } from './TrackProjection';

const FLAT_HIERARCHY_INDEX = compileHierarchy({});

interface TrackAssignmentOptions {
  hierarchyIndex?: TypeHierarchyIndex;
  replaceType?: string;
  confidence?: number;
}

function confidencePairsEqual(
  left: readonly ConfidencePair[],
  right: readonly ConfidencePair[],
): boolean {
  return left.length === right.length
    && left.every(([type, confidence], index) => (
      type === right[index][0] && confidence === right[index][1]
    ));
}

export function formatDivergentClassificationWarning(
  trackIds: readonly AnnotationId[],
): string | null {
  if (trackIds.length === 0) {
    return null;
  }
  const sortedIds = [...trackIds].sort((a, b) => a - b);
  const shownIds = sortedIds.slice(0, 10).join(', ');
  const suffix = sortedIds.length > 10 ? ', …' : '';
  return `${sortedIds.length} tracks have divergent per-camera classifications (tracks ${shownIds}${suffix})`;
}

/**
 * CameraStore is a warapper for holding and collating tracks from multiple cameras.
 * If a singleCamera is in operation it uses the root 'singleCam' with a single store.
 * There are helper functions for getting tracks if they exist in any camera, specific
 * cameras as well as merging tracks together to perform operations on all of them.
 */
export default class CameraStore {
  camMap: Ref<Map<string, { trackStore: TrackStore; groupStore: GroupStore }>>;

  markChangesPending: MarkChangesPending;

  sortedTracks: Ref<SortedAnnotation<Track>[]>;

  sortedGroups: Ref<SortedAnnotation<Group>[]>;

  defaultGroup: [string, number];

  private projectionCache: Map<AnnotationId, ComputedRef<TrackProjection | null>>;

  constructor({ markChangesPending }: { markChangesPending: MarkChangesPending }) {
    this.markChangesPending = markChangesPending;
    const cameraName = 'singleCam';
    this.defaultGroup = ['no-group', 1.0];
    this.projectionCache = new Map();
    this.camMap = shallowRef(new Map([[cameraName, {
      trackStore: new TrackStore({ markChangesPending, cameraName }),
      groupStore: new GroupStore({ markChangesPending, cameraName }),
    }]]));

    this.sortedTracks = computed(() => {
      let idList: AnnotationId[] = [];
      this.camMap.value.forEach((camera) => {
        idList = idList.concat(camera.trackStore.sorted.value.map((item) => item.id));
      });
      /**
         * The tracks need to be merged because this is used for Event/Detection viewing
         * This allows the full range begin/end for the track across multiple cameras to
         * be displayed.
         */
      return uniq(idList).map((id) => this.getTrackProjectionForSorted(id));
    });
    this.sortedGroups = computed(() => {
      let list: SortedAnnotation<Group>[] = [];
      this.camMap.value.forEach((camera) => {
        list = list.concat(camera.groupStore.sorted.value);
      });
      return list;
    });
  }

  getTrack(trackId: Readonly<AnnotationId>, cameraName = 'singleCam'): Track {
    const currentMap = this.camMap.value.get(cameraName)?.trackStore;
    if (!currentMap) {
      throw new Error(`No camera Map with the camera name: ${cameraName}`);
    }
    const tempTrack = currentMap?.get(trackId);
    if (!tempTrack) {
      throw new Error(`TrackId ${trackId} not found in trackMap with cameraName ${cameraName}`);
    }
    return tempTrack;
  }

  getPossibleTrack(trackId: Readonly<AnnotationId>, cameraName = 'singleCam'): Track | undefined {
    try {
      return this.getTrack(trackId, cameraName);
    } catch (err) {
      return undefined;
    }
  }

  getAnyPossibleTrack(trackId: Readonly<AnnotationId>) {
    // Map iteration order defines the canonical camera for logical-track reads.
    return Array.from(this.camMap.value.values())
      .map((camera) => camera.trackStore.getPossible(trackId))
      .find((track): track is Track => track !== undefined);
  }

  getAnyTrack(trackId: Readonly<AnnotationId>) {
    const track = this.getAnyPossibleTrack(trackId);
    if (track) {
      return track;
    }
    throw new Error(`TrackId ${trackId} not found in any camera`);
  }

  getTrackAll(trackId: Readonly<AnnotationId>):
        Track[] {
    const trackList: Track[] = [];
    this.camMap.value.forEach((camera) => {
      const tempTrack = camera.trackStore.getPossible(trackId);
      if (tempTrack) {
        trackList.push(tempTrack);
      }
    });
    return trackList;
  }

  divergentClassificationTrackIds(): AnnotationId[] {
    const vectorsByTrack = new Map<AnnotationId, ConfidencePair[][]>();
    this.camMap.value.forEach(({ trackStore }) => {
      trackStore.annotationIds.value.forEach((trackId) => {
        const track = trackStore.get(trackId);
        const vectors = vectorsByTrack.get(trackId) || [];
        vectors.push(track.confidencePairs);
        vectorsByTrack.set(trackId, vectors);
      });
    });
    return Array.from(vectorsByTrack.entries())
      .filter(([, vectors]) => vectors.length > 1
        && vectors.slice(1).some((vector) => !confidencePairsEqual(vectors[0], vector)))
      .map(([trackId]) => trackId)
      .sort((a, b) => a - b);
  }

  /**
   * Each entry rebuilds when a replica in any camera changes, when replicas are
   * inserted or removed, or when the camera set or order changes. Between edits,
   * callers receive the same projection object, so it is a stable identity.
   */
  private cachedProjection(trackId: Readonly<AnnotationId>): ComputedRef<TrackProjection | null> {
    const cached = this.projectionCache.get(trackId);
    if (cached !== undefined) {
      return cached;
    }
    const entry = computed(() => {
      const replicas: Track[] = [];
      this.camMap.value.forEach(({ trackStore }) => {
        if (trackStore.annotationIds.value.includes(trackId)) {
          const track = trackStore.getPossible(trackId);
          if (track) {
            replicas.push(track);
          }
        }
      });
      if (replicas.length === 0) {
        return null;
      }
      // An edit to any replica, not only the canonical one, invalidates this entry.
      replicas.forEach((track) => track.revision.value);
      return createTrackProjection(replicas);
    });
    this.projectionCache.set(trackId, entry);
    return entry;
  }

  getTrackProjection(trackId: Readonly<AnnotationId>): TrackProjection {
    const projection = this.cachedProjection(trackId).value;
    if (projection === null) {
      throw Error(`TrackId: ${trackId} is not found in any camera`);
    }
    return projection;
  }

  /**
   * The sorted list is recomputed on every annotation mutation, so it reads only the
   * logical range and classification rather than building a full TrackProjection, whose
   * per-feature deep copies would scale with the whole dataset on each edit. Safe only
   * once projections take classification from the canonical camera instead of merging.
   */
  getTrackProjectionForSorted(trackId: Readonly<AnnotationId>): SortedAnnotation<Track> {
    const tracks = this.getTrackAll(trackId);
    if (tracks.length === 0) {
      throw Error(`TrackId: ${trackId} is not found in any camera`);
    }
    const confidencePairs = tracks[0].confidencePairs
      .map(([type, confidence]) => [type, confidence] as ConfidencePair);
    return {
      id: tracks[0].id,
      confidencePairs,
      begin: Math.min(...tracks.map((track) => track.begin)),
      end: Math.max(...tracks.map((track) => track.end)),
      getType: (index?: number) => (confidencePairs[index || 0]?.[0] || 'unknown'),
    };
  }

  addCamera(cameraName: string) {
    if (this.camMap.value.get(cameraName) === undefined) {
      this.camMap.value.set(cameraName, {
        trackStore: new TrackStore({ markChangesPending: this.markChangesPending, cameraName }),
        groupStore: new GroupStore({ markChangesPending: this.markChangesPending, cameraName }),
      });
      // Bump the shallowRef
      triggerRef(this.camMap);
    }
  }

  removeCamera(cameraName: string) {
    if (this.camMap.value.get(cameraName) !== undefined) {
      this.camMap.value.delete(cameraName);
      // Bump the shallowRef
      triggerRef(this.camMap);
    }
  }

  lookupGroups(trackId: AnnotationId) {
    let groups: Group[] = [];
    if (this.camMap) {
      this.camMap.value.forEach((camera) => {
        const groupIds = camera.groupStore.trackMap.get(trackId);
        if (groupIds) {
          groups = groups.concat(Array.from(groupIds).map((v) => camera.groupStore.get(v)));
        }
      });
    }
    return groups;
  }

  remove(trackId: AnnotationId, cameraName = '') {
    this.camMap.value.forEach((camera) => {
      if (camera.trackStore.getPossible(trackId)) {
        if (cameraName === '' || camera.trackStore.cameraName === cameraName) {
          camera.trackStore.remove(trackId);
        }
        if (cameraName === '' || camera.groupStore.cameraName === cameraName) {
          camera.groupStore.trackRemove(trackId);
        }
      }
    });
    this.projectionCache.delete(trackId);
  }

  mergeTracks(targetId: AnnotationId, sourceIds: AnnotationId[]) {
    const replicas: Array<{
      trackStore: TrackStore;
      target?: Track;
      sources: Track[];
    }> = [];
    const vectors: ConfidencePair[][] = [];

    this.camMap.value.forEach(({ trackStore }) => {
      const target = trackStore.getPossible(targetId);
      const sources = sourceIds
        .map((sourceId) => trackStore.getPossible(sourceId))
        .filter((source): source is Track => source !== undefined);
      if (target || sources.length) {
        replicas.push({ trackStore, target, sources });
        if (target) {
          vectors.push(target.confidencePairs);
        }
        sources.forEach((source) => vectors.push(source.confidencePairs));
      }
    });

    const canonicalPairs = mergePairs(vectors);
    replicas.forEach((replica) => {
      let { target } = replica;
      if (!target) {
        const source = replica.sources[0];
        target = Track.fromJSON({
          id: targetId,
          begin: source.begin,
          end: source.end,
          confidencePairs: cloneDeep(source.confidencePairs),
          attributes: cloneDeep(source.attributes),
          features: cloneDeep(source.features.filter((feature) => feature !== undefined)),
          meta: cloneDeep(source.meta),
        }, source.set);
        replica.trackStore.insert(target);
      }
      target.merge(replica.sources);
      target.setConfidencePairs(canonicalPairs);
    });
  }

  getNewTrackId() {
    let trackIds: number[] = [];
    this.camMap.value.forEach((camera) => {
      trackIds = trackIds.concat(camera.trackStore.annotationIds.value);
    });
    if (!trackIds.length) {
      return 0;
    }
    return trackIds.reduce((prev, current) => Math.max(prev, current)) + 1;
  }

  clearAll() {
    this.camMap.value.forEach((camera) => {
      camera.trackStore.clearAll();
      camera.groupStore.clearAll();
    });
    this.projectionCache.clear();
  }

  removeTracks(id: AnnotationId, cameraName = '') {
    this.remove(id, cameraName);
  }

  removeGroups(id: AnnotationId, cameraName = '') {
    this.camMap.value.forEach((camera) => {
      if (camera.groupStore.getPossible(id)) {
        if (cameraName === '' || camera.groupStore.cameraName === cameraName) {
          camera.groupStore.remove(id);
        }
      }
    });
  }

  // Update all cameras to have the same track type
  setTrackType(id: AnnotationId, newType: string, confidenceVal?: number, currentType?: string) {
    this.camMap.value.forEach((camera) => {
      const track = camera.trackStore.getPossible(id);
      if (track !== undefined) {
        track.setType(newType, confidenceVal, currentType);
      }
    });
  }

  setGroupType(id: AnnotationId, newType: string, confidenceVal?: number, currentType?: string) {
    this.camMap.value.forEach((camera) => {
      const group = camera.groupStore.getPossible(id);
      if (group !== undefined) {
        group.setType(newType, confidenceVal, currentType);
      }
    });
  }

  private updateTrackConfidencePairs(
    id: AnnotationId,
    update: (pairs: readonly ConfidencePair[]) => ConfidencePair[],
    mergeReplicaPairs = false,
    deleteWhenEmpty = false,
  ): ConfidencePair[] {
    const tracks = this.getTrackAll(id);
    if (tracks.length === 0) {
      throw new Error(`TrackId ${id} not found in any camera`);
    }
    // Merging re-sorts equal-confidence pairs into a canonical order, which would move the
    // displayed type of a single-replica track that never needed reconciling.
    const canonicalPairs = mergeReplicaPairs && tracks.length > 1
      ? mergePairs(tracks.map((track) => track.confidencePairs))
      : tracks[0].confidencePairs
        .map(([type, confidence]) => [type, confidence] as ConfidencePair);
    const nextPairs = update(canonicalPairs);
    if (deleteWhenEmpty && nextPairs.length === 0) {
      this.remove(id);
      return [];
    }
    tracks.forEach((track) => {
      if (!confidencePairsEqual(track.confidencePairs, nextPairs)) {
        track.setConfidencePairs(nextPairs);
      }
    });
    return nextPairs.map(([type, confidence]) => [type, confidence]);
  }

  assignTrackType(
    id: AnnotationId,
    newType: string,
    {
      hierarchyIndex = FLAT_HIERARCHY_INDEX,
      replaceType,
      confidence = 1,
    }: TrackAssignmentOptions = {},
  ): ConfidencePair[] {
    return this.updateTrackConfidencePairs(id, (pairs) => reassignPairs(
      hierarchyIndex,
      pairs,
      replaceType ?? pairs[0]?.[0] ?? newType,
      newType,
      confidence,
    ));
  }

  acceptTrackType(
    id: AnnotationId,
    acceptedType: string,
    hierarchyIndex: TypeHierarchyIndex = FLAT_HIERARCHY_INDEX,
  ): ConfidencePair[] {
    return this.updateTrackConfidencePairs(
      id,
      (pairs) => acceptPairAsCorrect(hierarchyIndex, pairs, acceptedType),
    );
  }

  setTrackPairConfidence(
    id: AnnotationId,
    type: string,
    confidence: number,
  ): ConfidencePair[] {
    return this.updateTrackConfidencePairs(
      id,
      (pairs) => setPairConfidence(pairs, type, confidence),
    );
  }

  removeTrackPair(id: AnnotationId, type: string): ConfidencePair[] {
    return this.updateTrackConfidencePairs(id, (pairs) => removePair(pairs, type), true, true);
  }

  renameTrackPair(
    id: AnnotationId,
    currentType: string,
    newType: string,
  ): ConfidencePair[] {
    return this.updateTrackConfidencePairs(id, (pairs) => {
      const current = pairs.find(([type]) => type === currentType);
      if (!current) {
        return pairs.map(([type, confidence]) => [type, confidence]);
      }
      return setPairConfidence(removePair(pairs, currentType), newType, current[1]);
    });
  }

  setTrackNotes(id: AnnotationId, notes: string): void {
    const tracks = this.getTrackAll(id);
    if (tracks.length === 0) {
      throw new Error(`TrackId ${id} not found in any camera`);
    }
    tracks.forEach((track) => track.setFeatureNotes(track.begin, notes));
  }

  setTrackAttribute(
    id: AnnotationId,
    key: string,
    value: unknown,
    user: null | string = null,
  ): void {
    const tracks = this.getTrackAll(id);
    if (tracks.length === 0) {
      throw new Error(`TrackId ${id} not found in any camera`);
    }
    tracks.forEach((track) => track.setAttribute(key, value, user));
  }

  setTrackFeatureAttribute(
    id: AnnotationId,
    frame: number,
    key: string,
    value: unknown,
    user: null | string = null,
  ): void {
    const tracks = this.getTrackAll(id);
    if (tracks.length === 0) {
      throw new Error(`TrackId ${id} not found in any camera`);
    }
    tracks.forEach((track) => track.setFeatureAttribute(frame, key, value, user));
  }

  setTrackFirstFeatureAttribute(
    id: AnnotationId,
    key: string,
    value: unknown,
    user: null | string = null,
  ): void {
    const tracks = this.getTrackAll(id);
    if (tracks.length === 0) {
      throw new Error(`TrackId ${id} not found in any camera`);
    }
    tracks.forEach((track) => track.setFeatureAttribute(track.begin, key, value, user));
  }

  /**
   * Keyframe and interpolation edits are camera-local geometry, but the row that triggers them
   * comes from the all-camera projection, so the selected camera need not hold a replica.
   */
  private getTrackForCameraEdit(id: AnnotationId, cameraName: string): Track | undefined {
    return this.getPossibleTrack(id, cameraName) ?? this.getAnyPossibleTrack(id);
  }

  toggleTrackKeyframe(id: AnnotationId, frame: number, cameraName: string): void {
    this.getTrackForCameraEdit(id, cameraName)?.toggleKeyframe(frame);
  }

  toggleTrackInterpolation(id: AnnotationId, frame: number, cameraName: string): void {
    this.getTrackForCameraEdit(id, cameraName)?.toggleInterpolation(frame);
  }

  toggleTrackInterpolationForAllGaps(
    id: AnnotationId,
    frame: number,
    cameraName: string,
  ): void {
    this.getTrackForCameraEdit(id, cameraName)?.toggleInterpolationForAllGaps(frame);
  }

  removeTypes(id: AnnotationId, types: string[]): ConfidencePair[] {
    const removedTypes = new Set(types);
    return this.updateTrackConfidencePairs(
      id,
      (pairs) => pairs
        .filter(([type]) => !removedTypes.has(type))
        .map(([type, confidence]) => [type, confidence] as ConfidencePair),
      true,
      true,
    );
  }

  removeGroupTypes(id: AnnotationId, types: string[]): ConfidencePair[] {
    let result: ConfidencePair[] | undefined;
    this.camMap.value.forEach((camera) => {
      const group = camera.groupStore.getPossible(id);
      if (group !== undefined) {
        const pairs = group.removeTypes(types);
        if (result === undefined) {
          result = pairs.map(([type, confidence]) => [type, confidence] as ConfidencePair);
        }
      }
    });
    if (result === undefined) {
      throw new Error(`GroupId ${id} not found in any camera`);
    }
    return result;
  }

  getGroupMemebers(id: AnnotationId) {
    let members = {};
    this.camMap.value.forEach((camera) => {
      const group = camera.groupStore.get(id);
      if (group !== undefined) {
        members = group.members;
      }
    });
    return members;
  }
}
