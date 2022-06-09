import { Ref, computed, ref } from '@vue/composition-api';
import IntervalTree from '@flatten-js/interval-tree';
import { cloneDeep } from 'lodash';
import type Track from './track';
import type Group from './Group';
import { AnnotationId } from './BaseAnnotation';
import { MarkChangesPending } from './BaseAnnotationStore';
import GroupStore from './GroupStore';
import TrackStore from './TrackStore';


export default class CameraStore {
    camMap: Map<string, { trackStore: TrackStore; groupStore: GroupStore}>;

    markChangesPending: MarkChangesPending;

    intervalTree: IntervalTree;

    sortedTracks: Ref<Track[]>;

    sortedGroups: Ref<Group[]>;

    defaultGroup: [string, number];

    canary: Ref<number>;


    constructor({ markChangesPending }: { markChangesPending: MarkChangesPending }) {
      this.markChangesPending = markChangesPending;
      this.intervalTree = new IntervalTree();
      this.camMap = new Map<string, { trackStore: TrackStore; groupStore: GroupStore}>();
      const cameraName = 'singleCam';
      this.defaultGroup = ['no-group', 1.0];
      this.canary = ref(0);
      this.camMap.set(cameraName,
        {
          trackStore: new TrackStore({ markChangesPending, cameraName }),
          groupStore: new GroupStore({ markChangesPending, cameraName }),
        });

      // As you add cameras you need to triger the canary to it will
      // properly update the computed function
      this.sortedTracks = computed(() => {
        this.depend();
        let list: Track[] = [];
        this.camMap.forEach((camera) => {
          list = list.concat(camera.trackStore.sorted.value);
        });
        return list;
      });
      this.sortedGroups = computed(() => {
        this.depend();
        let list: Group[] = [];
        this.camMap.forEach((camera) => {
          list = list.concat(camera.groupStore.sorted.value);
        });
        return list;
      });
    }

    private depend() {
      return this.canary.value;
    }

    getTrack(trackId: Readonly<AnnotationId>, cameraName = 'singleCam'): Track {
      const currentMap = this.camMap.get(cameraName)?.trackStore;
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

    getAnyTrack(trackId: Readonly<AnnotationId>) {
      let track: Track | undefined;
      this.camMap.forEach((camera) => {
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
      this.camMap.forEach((camera) => {
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
      if (this.camMap.size === 1) {
        return this.getTrack(trackId);
      }
      let track: Track | undefined;
      this.camMap.forEach((camera) => {
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
      if (this.camMap.get(cameraName) === undefined) {
        this.camMap.set(cameraName,
          {
            trackStore: new TrackStore({ markChangesPending: this.markChangesPending, cameraName }),
            groupStore: new GroupStore({ markChangesPending: this.markChangesPending, cameraName }),
          });
      }
      this.canary.value += 1;
    }

    removeCamera(cameraName: string) {
      if (this.camMap.get(cameraName) !== undefined) {
        this.camMap.delete(cameraName);
      }
      this.canary.value += 1;
    }

    lookupGroups(trackId: AnnotationId) {
      let groups: Group[] = [];
      if (this.camMap) {
        this.camMap.forEach((camera) => {
          const groupIds = camera.groupStore.trackMap.get(trackId);
          if (groupIds) {
            groups = groups.concat(Array.from(groupIds).map((v) => camera.groupStore.get(v)));
          }
        });
      }
      return groups;
    }

    remove(trackId: AnnotationId, cameraName = '') {
      this.camMap.forEach((camera) => {
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
      this.camMap.forEach((camera) => {
        trackIds = trackIds.concat(camera.trackStore.annotationIds.value);
      });
      if (!trackIds.length) {
        return 0;
      }
      return trackIds.reduce((prev, current) => Math.max(prev, current)) + 1;
    }

    clearAll() {
      this.camMap.forEach((camera) => {
        camera.trackStore.clearAll();
        camera.groupStore.clearAll();
      });
    }

    removeTracks(id: AnnotationId, cameraName = '') {
      this.camMap.forEach((camera) => {
        if (camera.trackStore.getPossible(id)) {
          if (cameraName === '' || camera.trackStore.cameraName === cameraName) {
            camera.trackStore.remove(id);
          }
        }
      });
    }

    removeGroups(id: AnnotationId, cameraName = '') {
      this.camMap.forEach((camera) => {
        if (camera.groupStore.getPossible(id)) {
          if (cameraName === '' || camera.groupStore.cameraName === cameraName) {
            camera.groupStore.remove(id);
          }
        }
      });
    }
}
