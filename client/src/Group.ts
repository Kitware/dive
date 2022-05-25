import { omit } from 'lodash';
import BaseAnnotation, { AnnotationId, BaseAnnotationParams, BaseData } from './BaseAnnotation';

export type GroupMembers = Record<AnnotationId, {
  ranges: [number, number][];
}>;

export interface GroupData extends BaseData {
  members: GroupMembers;
}

/* Constructor params for Track */
interface GroupParams extends BaseAnnotationParams {
  members: GroupMembers;
}

export default class Group extends BaseAnnotation {
  members: GroupMembers;

  constructor(id: AnnotationId, params: GroupParams) {
    super(id, params);
    this.members = params.members;
  }

  /**
   * It would be easier to compute begin and end
   * as reactive computed properties, but it would require all
   * future developers to know about this and be very careful
   * where and how begin and end were used.
   *
   * Instead, we implement our own updater and call it anywhere
   * begin and end might be changed.
   */
  private setBoundsForMembers() {
    const oldval = [this.begin, this.end];
    this.begin = Infinity;
    this.end = 0;
    Object.values(this.members).forEach((m) => {
      m.ranges.forEach(([begin, end]) => {
        this.begin = Math.min(begin, this.begin);
        this.end = Math.max(end, this.end);
      });
    });
    if (this.begin !== oldval[0] || this.end !== oldval[1]) {
      this.notify('bounds', oldval);
    }
  }

  public get memberIds(): AnnotationId[] {
    return Object.keys(this.members).map((id) => parseInt(id, 10));
  }

  addMembers(members: GroupMembers) {
    let notify = false;
    Object.entries(members).forEach(([memberId, val]) => {
      const annotationId = parseInt(memberId, 10);
      if (!(annotationId in this.members)) {
        this.members[annotationId] = val;
        notify = true;
      }
    });
    this.setBoundsForMembers();
    if (notify) {
      this.notify('members');
    }
  }

  setMemberRange(memberId: AnnotationId, idx: number, range: [number, number]) {
    this.members[memberId].ranges[idx] = range;
    this.setBoundsForMembers();
    this.notify('members');
  }

  addMemberRange(memberId: AnnotationId, index: number, range: [number, number]) {
    this.members[memberId].ranges.splice(index, 0, range);
    this.setBoundsForMembers();
    this.notify('members');
  }

  removeMemberRange(memberId: AnnotationId, idx: number) {
    this.members[memberId].ranges.splice(idx, 1);
    this.setBoundsForMembers();
    this.notify('members');
  }

  removeMembers(members: AnnotationId[]) {
    this.members = omit(this.members, members);
    this.setBoundsForMembers();
    this.notify('remove-members', members);
  }

  serialize(): GroupData {
    return {
      id: this.id,
      meta: this.meta,
      attributes: this.attributes,
      confidencePairs: this.confidencePairs,
      members: this.members,
      begin: this.begin,
      end: this.end,
    };
  }

  static fromJSON(json: GroupData): Group {
    // accept either number or string, convert to number
    const intId = parseInt(json.id.toString(), 10);
    const track = new Group(intId, {
      members: json.members,
      meta: json.meta,
      attributes: json.attributes,
      confidencePairs: json.confidencePairs,
      begin: json.begin,
      end: json.end,
    });
    return track;
  }
}
