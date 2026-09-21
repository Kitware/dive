import { shallowMount, Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import TrainedModels from './TrainedModels.vue';

const mocks = vi.hoisted(() => ({
  getPipelineList: vi.fn(),
  deleteTrainedPipeline: vi.fn(),
  exportTrainedPipeline: vi.fn(),
  importModelPack: vi.fn(),
  prompt: vi.fn(),
  push: vi.fn(),
}));
vi.mock('dive-common/apispec', () => ({ useApi: () => mocks }));
vi.mock('dive-common/vue-utilities/prompt-service', () => ({ usePrompt: () => ({ prompt: mocks.prompt }) }));
vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('platform/web-girder/store/useConfig', () => ({
  useConfig: () => ({ getPipelinesEnabled: () => true, getTrainingEnabled: () => true }),
}));
vi.mock('platform/web-girder/api', () => ({ importModelPack: mocks.importModelPack, getUri: vi.fn() }));
Vue.config.ignoredElements = [/^v-/];

const model = {
  name: 'Fish', type: 'trained', pipe: 'detector.pipe', folderId: 'model-id',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPipelineList.mockResolvedValue({ trained: { pipes: [model] } });
});

interface ModelsVm extends Vue {
  headers: { text: string }[];
  archive: File | null;
  importDialog: boolean;
  busy: boolean;
  error: string;
  importModel(): Promise<void>;
  exportModel(item: typeof model): Promise<void>;
}

function mountModels(): Wrapper<ModelsVm> {
  return shallowMount(TrainedModels, { mocks: { $vuetify: { breakpoint: { mdAndDown: false } } } }) as Wrapper<ModelsVm>;
}

it('places ZIP export before ONNX conversion and keeps the description in one paragraph', () => {
  const wrapper = mountModels();
  const headers = wrapper.vm.headers.map((header) => header.text);
  expect(headers.indexOf('Export to ZIP')).toBeLessThan(headers.indexOf('Convert to ONNX'));
  expect(wrapper.find('br').exists()).toBe(false);
  expect(wrapper.text()).toContain('Import');
  wrapper.destroy();
});

it('imports a ZIP, refreshes the list, and closes the import dialog', async () => {
  const wrapper = mountModels();
  const file = new File(['zip'], 'fish.zip', { type: 'application/zip' });
  wrapper.vm.archive = file;
  wrapper.vm.importDialog = true;
  await wrapper.vm.importModel();
  expect(mocks.importModelPack).toHaveBeenCalledWith(file);
  expect(mocks.getPipelineList).toHaveBeenCalledTimes(2);
  expect(wrapper.vm.importDialog).toBe(false);
  expect(wrapper.vm.archive).toBeNull();
  expect(wrapper.vm.busy).toBe(false);
  wrapper.destroy();
});

it('keeps a failed import open and displays the error', async () => {
  mocks.importModelPack.mockRejectedValueOnce(new Error('Invalid model ZIP'));
  const wrapper = mountModels();
  wrapper.vm.archive = new File(['invalid'], 'fish.zip');
  wrapper.vm.importDialog = true;
  await wrapper.vm.importModel();
  expect(wrapper.vm.error).toContain('Invalid model ZIP');
  expect(wrapper.vm.importDialog).toBe(true);
  expect(wrapper.vm.busy).toBe(false);
  wrapper.destroy();
});

it('keeps ONNX conversion separate from ZIP export', async () => {
  const wrapper = mountModels();
  await wrapper.vm.exportModel(model);
  expect(mocks.exportTrainedPipeline).toHaveBeenCalledWith('model-id', model);
  expect(mocks.push).toHaveBeenCalledWith('/jobs');
  expect(mocks.importModelPack).not.toHaveBeenCalled();
  wrapper.destroy();
});
