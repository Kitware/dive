import { assign, omit } from 'lodash';
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

  private maybeExpandBoundsForMembers() {
    Object.values(this.members).forEach((m) => {
      m.ranges.forEach(([begin, end]) => {
        this.maybeExpandBounds(begin);
        this.maybeExpandBounds(end);
      });
    });
  }

  addMembers(members: GroupMembers) {
    if (Object.keys(members).some((v) => !(v in this.members))) {
      this.notify('members');
    }
    this.members = assign(this.members, members);
    this.maybeExpandBoundsForMembers();
  }

  setMembers(members: GroupMembers) {
    this.members = members;
    this.maybeExpandBoundsForMembers();
    this.notify('members');
  }

  removeMembers(members: AnnotationId[]) {
    this.members = omit(this.members, members);
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
