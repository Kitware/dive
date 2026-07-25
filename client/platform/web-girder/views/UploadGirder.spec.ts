// @vitest-environment jsdom
/* eslint-disable import/no-extraneous-dependencies */
import { mount } from '@vue/test-utils';
import Vue from 'vue';

import { describe, expect, it } from 'vitest';

import UploadGirder from './UploadGirder.vue';

Vue.config.ignoredElements = [/^v-/];

describe('UploadGirder row retirement', () => {
  it('names the row to remove so the parent never retires a different one', () => {
    const rows = [{ name: 'first' }, { name: 'second' }];
    const wrapper = mount(UploadGirder, {
      propsData: {
        location: { _id: 'folder-id', _modelType: 'folder' },
        pendingUploads: rows,
      },
      provide: { girderRest: {} },
    });

    wrapper.vm.remove(rows[0]);

    // An index payload would land on the parent's `remove(pendingUpload)` as a number,
    // whose indexOf is -1, retiring the last queued row instead.
    expect(wrapper.emitted('remove-upload')).toEqual([[rows[0]]]);
  });
});
