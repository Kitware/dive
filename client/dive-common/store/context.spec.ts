import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import context from './context';

function panel(name: string) {
  return { description: name, component: defineComponent({ name }) };
}

describe('context panel order', () => {
  it('ignores registration history', () => {
    const video = panel('VideoSearchContext');
    const extra = panel('ZExtraPanel');
    const multiCam = context.componentMap.MultiCamTools;
    const registration = context.componentMap.CameraRegistration;
    const group = context.componentMap.GroupSidebar;
    try {
      // What a single-cam then multicam load does: panels leave and come
      // back, landing at the end of componentMap.
      context.register(video);
      context.register(extra);
      context.unregister(multiCam);
      context.unregister(registration);
      context.unregister(group);
      context.register(group);
      context.register(registration);
      context.register(multiCam);

      expect(context.orderedEntries().map(([name]) => name)).toEqual([
        'DatasetInfo',
        'CameraRegistration',
        'MultiCamTools',
        'GroupSidebar',
        'ImageEnhancements',
        'TypeThreshold',
        'AttributesSideBar',
        'AttributeTrackFilters',
        'VideoSearchContext',
        'ZExtraPanel',
      ]);
    } finally {
      context.unregister(video);
      context.unregister(extra);
    }
  });
});
