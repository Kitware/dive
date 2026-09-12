import { shallowMount } from '@vue/test-utils';
import Vue, { ComponentOptions, CreateElement, nextTick } from 'vue';
import type { NavigationGuard } from 'vue-router';
import type { DatasetConfig } from 'dive-common/apispec';
import type { ReviewService } from 'dive-common/use/useReview';
import { takeReviewSession } from 'dive-common/review/reviewSession';
import ReviewPage from './ReviewPage.vue';

const mocks = vi.hoisted(() => ({
  guard: null as NavigationGuard | null,
  loadDetections: vi.fn(),
  saveDetections: vi.fn(async () => undefined),
}));
vi.mock('vue-router/composables', () => ({
  onBeforeRouteLeave: (guard: NavigationGuard) => { mocks.guard = guard; },
}));
vi.mock('dive-common/apispec', () => ({
  useApi: () => ({
    loadConfig: async (id: string) => ({
      id,
      name: id,
      type: 'image-sequence',
      fps: 1,
      imageData: [],
      videoUrl: undefined,
      createdAt: '',
      subType: null,
      multiCamMedia: null,
    } as DatasetConfig),
    loadDetections: mocks.loadDetections,
    saveDetections: mocks.saveDetections,
  }),
}));
vi.mock('dive-common/vue-utilities/prompt-service', () => ({ usePrompt: () => ({ prompt: vi.fn() }) }));
vi.mock('dive-common/store/settings', () => ({
  clientSettings: { autoSaveSettings: { enabled: false, delaySeconds: 60 } },
}));
vi.mock('dive-common/review/frameSource', () => ({ createFrameSource: () => null }));
vi.mock('dive-common/components/UserSettingsDialog.vue', () => ({ default: {} }));
vi.mock('./ReviewDatasetsPanel.vue', () => ({ default: {} }));
vi.mock('./ReviewGrid.vue', () => ({ default: {} }));
vi.mock('./ReviewGridControls.vue', () => ({ default: {} }));
vi.mock('./ReviewCell.vue', () => ({ default: {} }));

interface PageState {
  review: ReviewService;
  view: 'results' | 'datasets';
  resolveLeave(choice: 'save' | 'discard' | 'cancel'): void;
  leaveDialog: boolean;
}

function mountPage(propsData = {}) {
  // Exercise the real setup/lifecycle and guard, without rendering Vuetify/media.
  return shallowMount({ ...(ReviewPage as unknown as ComponentOptions<Vue>), render: (h: CreateElement) => h('div') }, { propsData });
}

beforeEach(() => {
  takeReviewSession()?.review.dispose();
  mocks.loadDetections.mockReset().mockResolvedValue({
    tracks: [{
      id: 1,
      begin: 0,
      end: 0,
      confidencePairs: [['fish', 0.9]],
      attributes: {},
      features: [{ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }],
    }],
    groups: [],
    sets: [],
    version: 2,
  });
});

it('stays mounted with pending edits when Discard and Leave fails', async () => {
  const wrapper = mountPage();
  const page = wrapper.vm as unknown as PageState;
  await page.review.addDataset('a');
  page.review.assignType(page.review.items.value[0], 'shark');
  mocks.loadDetections.mockRejectedValue(new Error('offline'));
  const next = vi.fn();
  const navigation = mocks.guard!({} as never, {} as never, next);
  expect(page.leaveDialog).toBe(true);
  page.resolveLeave('discard');
  await navigation;
  expect(next).toHaveBeenCalledWith(false);
  expect(page.review.pendingCount.value).toBe(1);
  expect(page.review.error.value).toContain('Could not discard');
  wrapper.destroy();
});

it('refreshes data and guards edits after leaving and remounting Review', async () => {
  const first = mountPage();
  const original = first.vm as unknown as PageState;
  await original.review.addDataset('a');
  await mocks.guard!({} as never, {} as never, vi.fn());
  first.destroy();
  const second = mountPage();
  const resumed = second.vm as unknown as PageState;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  expect(resumed.review).toBe(original.review);
  expect(mocks.loadDetections).toHaveBeenCalledTimes(2);
  resumed.review.assignType(resumed.review.items.value[0], 'shark');
  expect(resumed.review.pendingCount.value).toBe(1);
  const next = vi.fn();
  const navigation = mocks.guard!({} as never, {} as never, next);
  expect(resumed.leaveDialog).toBe(true);
  resumed.resolveLeave('cancel');
  await navigation;
  expect(next).toHaveBeenCalledWith(false);
  second.destroy();
});

it("does not resume another web account's annotations", async () => {
  const first = mountPage({ sessionOwner: 'alice' });
  const original = first.vm as unknown as PageState;
  await original.review.addDataset('private');
  await mocks.guard!({} as never, {} as never, vi.fn());
  first.destroy();
  const dispose = vi.spyOn(original.review, 'dispose');
  const second = mountPage({ sessionOwner: 'bob' });
  const fresh = second.vm as unknown as PageState;
  expect(fresh.review).not.toBe(original.review);
  expect(fresh.review.datasets.value).toEqual([]);
  expect(dispose).toHaveBeenCalledOnce();
  second.destroy();
});

it('disposes the active review instead of parking it on logout', async () => {
  const wrapper = mountPage({ sessionOwner: 'alice' });
  const page = wrapper.vm as unknown as PageState;
  await page.review.addDataset('private');
  page.review.assignType(page.review.items.value[0], 'shark');
  await wrapper.setProps({ retainSession: false });
  const next = vi.fn();
  await mocks.guard!({} as never, {} as never, next);
  expect(next).toHaveBeenCalledWith();
  expect(page.leaveDialog).toBe(false);
  const dispose = vi.spyOn(page.review, 'dispose');
  wrapper.destroy();
  expect(dispose).toHaveBeenCalledOnce();
  expect(takeReviewSession()).toBeNull();
});

async function settlePage() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

it('opens the current sequence alone in Results on the first Review visit', async () => {
  const wrapper = mountPage({ fallbackDatasetId: 'current' });
  const page = wrapper.vm as unknown as PageState;
  await settlePage();
  expect(page.review.datasets.value.map((d) => d.id)).toEqual(['current']);
  expect(page.view).toBe('results');
  wrapper.destroy();
});

it.each(['untouched', 'selected', 'cleared'])('only seeds an untouched previous selection (%s)', async (selection) => {
  const first = mountPage();
  const original = first.vm as unknown as PageState;
  await settlePage();
  if (selection !== 'untouched') await original.review.addDataset('prior');
  if (selection === 'cleared') original.review.removeDataset('prior');
  await mocks.guard!({} as never, {} as never, vi.fn());
  first.destroy();
  const second = mountPage({ fallbackDatasetId: 'current' });
  const page = second.vm as unknown as PageState;
  await settlePage();
  expect(page.review).toBe(original.review);
  expect(page.review.datasets.value.map((d) => d.id)).toEqual(
    selection === 'untouched' ? ['current'] : (selection === 'selected' ? ['prior'] : []),
  );
  expect(page.view).toBe(selection === 'cleared' ? 'datasets' : 'results');
  second.destroy();
});

it('preserves explicit Library selections over the current sequence fallback', async () => {
  const wrapper = mountPage({ initialDatasetIds: ['library'], fallbackDatasetId: 'current' });
  const page = wrapper.vm as unknown as PageState;
  await settlePage();
  expect(page.review.datasets.value.map((d) => d.id)).toEqual(['library']);
  expect(page.view).toBe('results');
  wrapper.destroy();
});

it('keeps a plain first Review visit on Datasets', async () => {
  const wrapper = mountPage();
  const page = wrapper.vm as unknown as PageState;
  await settlePage();
  expect(page.review.datasets.value).toEqual([]);
  expect(page.view).toBe('datasets');
  wrapper.destroy();
});
