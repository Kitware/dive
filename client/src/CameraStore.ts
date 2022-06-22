import {
  Ref, computed, shallowRef, triggerRef,
} from '@vue/composition-api';
import { cloneDeep, uniq } from 'lodash';
import type Track from './track';
import type Group from './Group';
import { AnnotationId } from './BaseAnnotation';
import { MarkChangesPending } from './BaseAnnotationStore';
import GroupStore from './GroupStore';
import TrackStore from './TrackStore';

/**
 * CameraStore is a warapper for holding and collating tracks from multiple cameras.
 * If a singleCamera is in operation it uses the root 'singleCam' with a single store.
 * There are helper functions for getting tracks if they exist in any camera, specific
 * cameras as well as merging tracks together to perform operations on all of them.
 */
export default class CameraStore {
    camMap: Ref<Map<string, { trackStore: TrackStore; groupStore: GroupStore }>>;

    markChangesPending: MarkChangesPending;

    sortedTracks: Ref<Track[]>;

    sortedGroups: Ref<Group[]>;

    defaultGroup: [string, number];

    constructor({ markChangesPending }: { markChangesPending: MarkChangesPending }) {
      this.markChangesPending = markChangesPending;
      const cameraName = 'singleCam';
      this.defaultGroup = ['no-group', 1.0];
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
        return uniq(idList).map((id) => this.getTracksMerged(id));
      });
      this.sortedGroups = computed(() => {
        let list: Group[] = [];
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
      let track: Track | undefined;
      this.camMap.value.forEach((camera) => {
        const tempTrack = camera.trackStore.getPossible(trackId);
        if (tempTrack) {
          track = tempTrack;
        }
      });
      if (track) {
        return track;
      }
      return undefined;
    }

    getAnyTrack(trackId: Readonly<AnnotationId>) {
      let track: Track | undefined;
      this.camMap.value.forEach((camera) => {
        const tempTrack = camera.trackStore.getPossible(trackId);
        if (tempTrack) {
          track = tempTrack;
        }
      });
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


    getTracksMerged(
      trackId: Readonly<AnnotationId>,
    ): Track {
      if (this.camMap.value.size === 1) {
        return this.getTrack(trackId);
      }
      let track: Track | undefined;
      this.camMap.value.forEach((camera) => {
        const tempTrack = camera.trackStore.getPossible(trackId);
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
    }

    removeTracks(id: AnnotationId, cameraName = '') {
      this.camMap.value.forEach((camera) => {
        if (camera.trackStore.getPossible(id)) {
          if (cameraName === '' || camera.trackStore.cameraName === cameraName) {
            camera.trackStore.remove(id);
          }
        }
      });
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
    setTrackType(id: AnnotationId, type: string) {
      this.camMap.value.forEach((camera) => {
        const track = camera.trackStore.getPossible(id);
        if (track !== undefined) {
          track.setType(type);
        }
      });
    }

    changeTrackTypes({ currentType, newType }: { currentType: string; newType: string }) {
      this.camMap.value.forEach((camera) => {
        camera.trackStore.sorted.value.forEach((annotation) => {
          for (let i = 0; i < annotation.confidencePairs.length; i += 1) {
            const [name, confidenceVal] = annotation.confidencePairs[i];
            if (name === currentType) {
              annotation.setType(newType, confidenceVal, currentType);
              break;
            }
          }
        });
      });
    }
}
