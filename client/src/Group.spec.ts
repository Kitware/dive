/// <reference types="jest" />

import Vue from 'vue';
import CompositionApi from '@vue/composition-api';
import { merge } from 'lodash';
import Group, { GroupMembers } from './Group';

Vue.use(CompositionApi);

const member0: GroupMembers = { 0: { ranges: [[0, 10]] } };
const member100: GroupMembers = { 100: { ranges: [[20, 30]] } };

describe('Group', () => {
  it('can add members', () => {
    const group = new Group(0, { members: {} });
    expect(group.memberIds).toEqual([]);
    expect(group.members).toEqual({});
    group.addMembers(member0);
    expect(group.memberIds).toEqual([0]);
    /** addMembers on an existing member doesn't do anything */
    group.addMembers({ 0: { ranges: [[20, 30]] } });
    expect(group.members).toEqual(member0);
    group.addMembers(member100);
    expect(group.members).toEqual(merge(member0, member100));
  });

  it('range reflects member range', () => {
    const notifier = jest.fn();
    const group = new Group(0, { members: {} });
    group.notifier = notifier;
    group.addMembers(member0);
    group.addMembers(member100);
    expect(group.begin).toBe(0);
    expect(group.end).toBe(30);

    group.removeMembers([100]);
    expect(group.begin).toBe(0);
    expect(group.end).toBe(10);

    group.addMembers(member100);
    group.addMemberRange(100, 1, [100, 200]);
    expect(group.begin).toBe(0);
    expect(group.end).toBe(200);

    group.removeMembers([0]);
    expect(group.begin).toBe(20);
    expect(group.end).toBe(200);

    group.removeMemberRange(100, 0);
    expect(group.begin).toBe(100);
    expect(group.end).toBe(200);

    expect(notifier.mock.calls.length).toBe(12);
  });
});
