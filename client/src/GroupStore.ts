import BaseAnnotationStore, { InsertArgs, MarkChangesPending } from './BaseAnnotationStore';
import type { AnnotationId } from './BaseAnnotation';
import Group, { GroupMembers } from './Group';
import MultiMap from './MultiMap';
import type Track from './track';

export default class GroupStore extends BaseAnnotationStore<Group> {
  // fast reverse mapping of tracks to the collection of groups they are in.
  trackMap: MultiMap<AnnotationId, AnnotationId>;

  defaultGroup: [string, number];

  constructor({ markChangesPending, cameraName }:
    { markChangesPending: MarkChangesPending; cameraName: string }) {
    super({ markChangesPending, cameraName });
    this.trackMap = new MultiMap();
    this.defaultGroup = ['no-group', 1.0];
  }

  insert(group: Group, args?: InsertArgs) {
    super.insert(group, args);
    group.memberIds.forEach((id) => {
      this.trackMap.add(id, group.id);
    });
    group.setNotifier((params) => {
      super.notify(params);
      if (params.event === 'remove-members') {
        (params.oldValue as number[]).forEach((trackId) => {
          this.trackMap.remove(trackId, group.id);
        });
      } else if (params.event === 'members') {
        group.memberIds.forEach((id) => {
          this.trackMap.add(id, group.id);
        });
      }
    });
  }

  /**
   * Initialize a new group with members
   */
  add(members: Track[], defaultType: string) {
    const newId = this.getNewId();
    const begin = Math.min(...members.map((m) => m.begin));
    const end = Math.max(...members.map((m) => m.end));
    const memberMap: GroupMembers = {};
    members.forEach((m) => {
      memberMap[m.id] = {
        ranges: [[m.begin, m.end]],
      };
    });
    const group = new Group(newId, {
      begin,
      end,
      confidencePairs: [[defaultType, 1]],
      members: memberMap,
    });
    this.insert(group);
    return group;
  }

  remove(annotationId: number, disableNotifications = false): void {
    const group = this.get(annotationId);
    group.memberIds.forEach((id) => {
      this.trackMap.remove(id, group.id);
    });
    super.remove(annotationId, disableNotifications);
  }

  /**
   * Notify the group store that a track has been removed
   */
  trackRemove(annotationId: number) {
    this.lookupGroups(annotationId).forEach((group) => {
      /** Remove deleted track from group reference */
      group.removeMembers([annotationId]);
      if (group.memberIds.length === 0) {
        /** If you removed the last track, delete the group */
        this.remove(group.id);
      }
    });
  }

  lookupGroups(trackId: AnnotationId) {
    const groupIds = this.trackMap.get(trackId);
    if (groupIds) {
      return Array.from(groupIds).map((v) => this.get(v));
    }
    return [];
  }

  clearAll(): void {
    this.trackMap = new MultiMap();
    super.clearAll();
  }
}
