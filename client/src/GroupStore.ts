import BaseAnnotationStore, { InsertArgs, MarkChangesPending } from './BaseAnnotationStore';
import { AnnotationId } from './BaseAnnotation';
import Group from './Group';
import MultiMap from './MultiMap';

export default class GroupStore extends BaseAnnotationStore<Group> {
  // fast reverse mapping of tracks to the collection of groups they are in.
  trackMap: MultiMap<AnnotationId, AnnotationId>;

  defaultGroup: [string, number];

  constructor({ markChangesPending }: { markChangesPending: MarkChangesPending }) {
    super({ markChangesPending });
    this.trackMap = new MultiMap();
    this.defaultGroup = ['none', 1.0];
  }

  insert(group: Group, args?: InsertArgs) {
    super.insert(group, args);
    Object.keys(group.members).forEach((id) => {
      this.trackMap.add(Number.parseInt(id, 10), group.id);
    });
    group.setNotifier((params) => {
      super.notify(params);
      if (params.event === 'remove-members') {
        (params.oldValue as number[]).forEach((v) => {
          this.trackMap.remove(group.id, v);
        });
      }
    });
  }

  remove(annotationId: number, disableNotifications = false): void {
    const group = this.get(annotationId);
    Object.keys(group.members).forEach((member) => {
      this.trackMap.remove(Number.parseInt(member, 10), group.id);
    });
    super.remove(annotationId, disableNotifications);
  }

  lookupGroups(trackId: AnnotationId) {
    const groupIds = this.trackMap.get(trackId);
    if (groupIds) {
      return Array.from(groupIds).map((v) => this.get(v));
    }
    return [];
  }
}
