// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils';
import type Vue from 'vue';
import type { ComponentOptions } from 'vue';
import ReviewCell from './ReviewCell.vue';
import ReviewChip from './ReviewChip.vue';

const view = (key: string) => ({
  key, src: null, srcs: null, transform: null, transforms: null, frames: [], failure: null, frameCount: 1, label: key,
});

function controls(views: ReturnType<typeof view>[]) {
  const wrapper = shallowMount(ReviewCell as unknown as ComponentOptions<Vue>, { propsData: { views } });
  return wrapper.findAllComponents(ReviewChip).wrappers
    .map((chip) => [chip.props('entryActions'), chip.props('sequenceControls')]);
}

it('shows the entry-wide controls once across the cameras of an entry', () => {
  expect(controls([view('left'), view('right')])).toEqual([[false, true], [true, false]]);
});

it('keeps every control on a single-camera entry', () => {
  expect(controls([view('only')])).toEqual([[true, true]]);
});
