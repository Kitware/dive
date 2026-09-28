import { markRaw } from 'vue';
import type { VueConstructor } from 'vue';
import { shallowMount } from '@vue/test-utils';
import EditorMenu from './EditorMenu.vue';
import SegmentationPointClick from '../recipes/segmentationpointclick';

const USAGE = 'Left click: positive point. Esc to cancel. Middle click or shift+click for negative.';
const BUSY = 'Computing segmentation… Press Esc to cancel.';

function mountWithSegmentation() {
  const recipe = new SegmentationPointClick();
  recipe.active.value = true;
  const wrapper = shallowMount(EditorMenu as unknown as VueConstructor, {
    propsData: {
      editingTrack: false,
      editingMode: false,
      editingDetails: 'disabled',
      visibleModes: ['rectangle'],
      recipes: [markRaw(recipe)],
    },
    directives: { mousetrap: () => {} },
  });
  return { wrapper, recipe };
}

describe('point segmentation hint', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps the usage hint through a quick predict', async () => {
    const { wrapper, recipe } = mountWithSegmentation();
    expect(wrapper.text()).toContain(USAGE);
    recipe.predicting.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain(USAGE);
    expect(wrapper.text()).not.toContain(BUSY);
    recipe.predicting.value = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toContain(USAGE);
    wrapper.destroy();
  });

  it('shows the busy hint once a predict runs past half a second', async () => {
    const { wrapper, recipe } = mountWithSegmentation();
    recipe.predicting.value = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(wrapper.text()).toContain(BUSY);
    recipe.predicting.value = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain(USAGE);
    wrapper.destroy();
  });
});
