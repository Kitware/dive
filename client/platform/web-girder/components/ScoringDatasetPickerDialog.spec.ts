import { shallowMount } from '@vue/test-utils';
import Vue, { ComponentOptions, CreateElement, nextTick } from 'vue';
import Picker from './ScoringDatasetPickerDialog.vue';
import {
  pickReviewDataset, pickScoringDataset, finishScoringDatasetPicker, scoringDatasetPickerState,
} from '../api/scoringDatasetPicker';

vi.mock('@girder/components/src', () => ({ GirderFileManager: {} }));
vi.mock('platform/web-girder/plugins/girder', () => ({ useGirderRest: () => ({ user: { _id: 'user', login: 'reader' } }) }));
vi.mock('platform/web-girder/store/useLocation', () => ({ useLocation: () => ({ getLocation: () => null }) }));

function mountPicker() {
  const wrapper = shallowMount({
    ...(Picker as unknown as ComponentOptions<Vue>), render: (h: CreateElement) => h('div'),
  });
  return { wrapper, vm: wrapper.vm as unknown as InstanceType<typeof Picker> };
}
const rig = {
  _id: 'rig', _modelType: 'folder' as const, name: 'Stereo', meta: { annotate: true, type: 'multi' },
};

beforeEach(() => finishScoringDatasetPicker(null));
afterEach(() => finishScoringDatasetPicker(null));

it('allows selecting a complete stereo sequence for review', async () => {
  const { vm, wrapper } = mountPicker();
  const result = pickReviewDataset([]);
  await nextTick();
  vm.setLocation(rig);
  expect(vm.canAdd).toBe(true);
  expect(vm.invalidSelection).toBeNull();
  vm.confirm();
  await expect(result).resolves.toEqual({ id: 'rig', name: 'Stereo', type: 'multi' });
  wrapper.destroy();
});

it('preserves scoring restrictions when switching back from review', async () => {
  const { vm, wrapper } = mountPicker();
  const review = pickReviewDataset([]);
  await nextTick();
  vm.setLocation(rig);
  vm.cancel();
  await expect(review).resolves.toBeNull();
  await nextTick();
  const scoring = pickScoringDataset([]);
  await nextTick();
  expect(scoringDatasetPickerState.purpose).toBe('scoring');
  vm.setLocation(rig);
  expect(vm.canAdd).toBe(false);
  vm.setLocation({
    ...rig, _id: 'left', name: 'left', meta: { annotate: true, type: 'video' },
  });
  expect(vm.canAdd).toBe(true);
  vm.confirm();
  await expect(scoring).resolves.toEqual({ id: 'left', name: 'left', type: 'video' });
  wrapper.destroy();
});

it('prevents duplicate parent selections and cancels when dismissed', async () => {
  const { vm, wrapper } = mountPicker();
  const result = pickReviewDataset(['rig']);
  await nextTick();
  vm.setLocation(rig);
  expect(vm.canAdd).toBe(false);
  expect(vm.invalidSelection).toContain('already');
  vm.onDialogInput(false);
  await expect(result).resolves.toBeNull();
  wrapper.destroy();
});
