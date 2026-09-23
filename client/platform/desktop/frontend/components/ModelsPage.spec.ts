// @vitest-environment jsdom
import { shallowMount, Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import ModelsPage from './ModelsPage.vue';

const mocks = vi.hoisted(() => ({
  getPipelineList: vi.fn(),
  deleteTrainedPipeline: vi.fn(),
  exportTrainedPipeline: vi.fn(),
  prompt: vi.fn(),
  push: vi.fn(),
  invoke: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));
vi.mock('dive-common/apispec', () => ({ useApi: () => mocks }));
vi.mock('dive-common/vue-utilities/prompt-service', () => ({ usePrompt: () => ({ prompt: mocks.prompt }) }));
vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('./NavigationBar.vue', () => ({ default: { render: () => null } }));
Vue.config.ignoredElements = [/^v-/];
const model = {
  name: 'Fish', type: 'trained', pipe: '/models/fish/custom.pipe', onnxConvertible: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPipelineList.mockResolvedValue({ trained: { pipes: [model] } });
  Object.defineProperty(window, 'diveDesktop', { configurable: true, value: mocks });
});
interface ModelsVm extends Vue {
  importModel(): Promise<void>;
  exportZip(item: typeof model): Promise<void>;
  deleteModel(item: typeof model): Promise<void>;
  exportModel(item: typeof model): Promise<void>;
  onnxTooltip(item: typeof model): string;
}

function mountModels(): Wrapper<ModelsVm> {
  return shallowMount(ModelsPage, { mocks: { $vuetify: { breakpoint: { mdAndDown: false } } } }) as Wrapper<ModelsVm>;
}

it('imports a selected ZIP and refreshes the models', async () => {
  mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/fish.zip'] });
  const wrapper = mountModels();
  await wrapper.vm.importModel();
  expect(mocks.invoke).toHaveBeenCalledWith('import-model-pack', '/fish.zip');
  expect(mocks.getPipelineList).toHaveBeenCalledTimes(2);
  wrapper.destroy();
});

it('does nothing when the import dialog is canceled', async () => {
  mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  const wrapper = mountModels();
  await wrapper.vm.importModel();
  expect(mocks.invoke).not.toHaveBeenCalled();
  wrapper.destroy();
});

it('exports the selected pack through ZIP IPC without starting ONNX conversion', async () => {
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/fish.zip' });
  const wrapper = mountModels();
  await wrapper.vm.exportZip(model);
  expect(mocks.invoke).toHaveBeenCalledWith('export-model-pack', model, '/fish.zip');
  expect(mocks.exportTrainedPipeline).not.toHaveBeenCalled();
  wrapper.destroy();
});

it('asks before deleting a pack and refreshes after deletion', async () => {
  mocks.prompt.mockResolvedValue(true);
  const wrapper = mountModels();
  await wrapper.vm.deleteModel(model);
  expect(mocks.prompt).toHaveBeenCalledWith(expect.objectContaining({ confirm: true }));
  expect(mocks.deleteTrainedPipeline).toHaveBeenCalledWith(model);
  expect(mocks.getPipelineList).toHaveBeenCalledTimes(2);
  wrapper.destroy();
});

it('explains why ONNX conversion is unavailable without convertible weights', () => {
  const wrapper = mountModels();
  expect(wrapper.vm.onnxTooltip({ ...model, onnxConvertible: false })).toContain('.weights');
  expect(wrapper.vm.onnxTooltip(model)).toBe('Convert to ONNX');
  wrapper.destroy();
});

it('does not start ONNX conversion when the pack is not convertible', async () => {
  const wrapper = mountModels();
  await wrapper.vm.exportModel({ ...model, onnxConvertible: false });
  expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  expect(mocks.exportTrainedPipeline).not.toHaveBeenCalled();
  wrapper.destroy();
});
