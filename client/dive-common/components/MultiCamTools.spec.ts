import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import MultiCamTools from './MultiCamTools.vue';

const state = vi.hoisted(() => ({
  readOnlyMode: false,
  offsetEditLock: false,
}));

vi.mock('dive-common/apispec', () => ({
  useApi: () => ({ applyCameraFrameOffset: vi.fn() }),
}));

vi.mock('vue-media-annotator/provides', () => ({
  useSelectedCamera: () => ref('left'),
  useEditingMode: () => ref(false),
  useTrackFilters: () => ({ enabledAnnotations: ref([]) }),
  useHandler: () => ({ save: vi.fn(), reloadCameraAnnotations: vi.fn() }),
  useTime: () => ({ frame: ref(0), frameRate: ref(30) }),
  useSelectedTrackId: () => ref(null),
  useCameraStore: () => ({ orderedCameraNames: () => ['left', 'right'] }),
  useCameraRegistration: () => ({
    frameOffsets: ref({ right: 3 }),
    appliedFrameOffsets: ref({}),
  }),
  useDatasetId: () => ref('dataset'),
  usePendingSaveCount: () => ref(0),
  useReadOnlyMode: () => ref(state.readOnlyMode),
  useOffsetEditLock: () => ref(state.offsetEditLock),
}));

function applyButton() {
  const Host = defineComponent({ setup: () => () => h(MultiCamTools) });
  const wrapper = shallowMount(Host, { stubs: { MultiCamTools: false } });
  const button = wrapper.findAll('v-btn').wrappers
    .find((b) => b.text().includes('Apply to annotations'));
  if (!button) throw new Error('Apply to annotations button not rendered');
  return { wrapper, button };
}

it('keeps Apply enabled when editing is paused only by the pending offset', () => {
  state.readOnlyMode = true;
  state.offsetEditLock = true;
  const { wrapper, button } = applyButton();
  expect(button.attributes('disabled')).toBeUndefined();
  expect(wrapper.text()).toContain('Annotation editing is paused until the offset is applied.');
});

it('disables Apply in a truly read-only view', () => {
  state.readOnlyMode = true;
  state.offsetEditLock = false;
  const { wrapper, button } = applyButton();
  expect(button.attributes('disabled')).toBeDefined();
  expect(wrapper.text()).not.toContain('Annotation editing is paused');
});
