// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- lightweight Vuetify test doubles */
import Vue, { h, PropType } from 'vue';
import { shallowMount } from '@vue/test-utils';
import Addons from './Addons.vue';
import type { AddonCatalog } from '../../addons';

vi.mock('./NavigationBar.vue', () => ({ default: { render: () => null } }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = Vue.extend({
  props: { disabled: Boolean },
  render() { return h('button', { attrs: { disabled: this.disabled }, on: this.$listeners }, this.$slots.default); },
});
const table = Vue.extend({
  props: { items: { type: Array as PropType<{ name: string }[]>, default: () => [] } },
  render() {
    return h('div', this.items.map((item: { name: string }) => h('section', { attrs: { 'data-addon': item.name } }, [
      item.name, this.$scopedSlots['item.status']?.({ item }), this.$scopedSlots['item.actions']?.({ item }),
    ])));
  },
});
let catalog: AddonCatalog;
let invoke: ReturnType<typeof vi.fn>;
let showOpenDialog: ReturnType<typeof vi.fn>;
beforeEach(() => {
  catalog = {
    installDir: '/opt/viame',
    installerAvailable: true,
    readOnly: false,
    job: null,
    addons: [{
      name: 'FISH', description: 'Fish model', url: 'https://example.test/fish.zip', requires: ['ONNX'], marker: 'models/fish.pt', status: 'not installed',
    }],
  };
  invoke = vi.fn(async (channel) => {
    if (channel === 'desktop:addons-install') {
      catalog.job = {
        name: 'FISH', installDir: '/opt/viame', running: true, log: 'Downloading',
      };
    }
    return channel === 'desktop:addons-list' ? structuredClone(catalog) : catalog.job;
  });
  showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/pack.zip'] }));
  Object.defineProperty(window, 'diveDesktop', { configurable: true, value: { invoke, showOpenDialog } });
});
function mount() {
  return shallowMount(Addons, {
    stubs: {
      'v-btn': button, 'v-data-table': table, 'router-link': true,
    },
  });
}

it('refreshes filesystem status when the desktop regains focus', async () => {
  const wrapper = mount(); await flush();
  expect(wrapper.text()).toContain('not installed');
  catalog.addons[0].status = 'installed';
  window.dispatchEvent(new Event('focus')); await flush();
  expect(wrapper.text()).toContain('Download and Install');
  wrapper.destroy();
});

it('starts an install and disables further installs while the job runs', async () => {
  const wrapper = mount(); await flush();
  await wrapper.findAll('button').wrappers.find((b) => b.text() === 'Download and Install')!.trigger('click'); await flush();
  expect(invoke).toHaveBeenCalledWith('desktop:addons-install', { name: 'FISH', archive: undefined, force: false });
  expect(wrapper.text()).toContain('Installing');
  const installButton = wrapper.findAll('button').wrappers.find((b) => b.text() === 'Download and Install')!;
  expect(installButton.attributes('disabled')).toBeDefined();
  wrapper.destroy();
});

it('passes downloaded ZIPs and explicit reinstall intent to the installer', async () => {
  catalog.addons[0].status = 'installed';
  const wrapper = mount(); await flush();
  await wrapper.findAll('button').wrappers.find((b) => b.text() === 'Import Local ZIP')!.trigger('click'); await flush();
  expect(invoke).toHaveBeenCalledWith('desktop:addons-install', { name: 'FISH', archive: '/tmp/pack.zip', force: true });
  wrapper.destroy();
});

it('does not install when the ZIP picker is canceled', async () => {
  showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  const wrapper = mount(); await flush();
  await wrapper.findAll('button').wrappers.find((b) => b.text() === 'Import Local ZIP')!.trigger('click'); await flush();
  expect(invoke.mock.calls.some(([channel]) => channel === 'desktop:addons-install')).toBe(false);
  wrapper.destroy();
});

it('shows unavailable installer and unknown-status explanations', async () => {
  catalog.installerAvailable = false;
  catalog.addons[0].status = 'unknown';
  const wrapper = mount(); await flush();
  expect(wrapper.text()).toContain('Update VIAME');
  expect(wrapper.text()).toContain('status is unknown');
  expect(wrapper.findAll('button').wrappers.find((b) => b.text() === 'Download and Install')!.attributes('disabled')).toBeDefined();
  wrapper.destroy();
});

it('shows separate download and installation progress with detailed errors', async () => {
  catalog.job = {
    name: 'FISH',
    installDir: '/opt/viame',
    running: true,
    log: '',
    phase: 'download',
    downloadProgress: 37,
  };
  const wrapper = mount(); await flush();
  expect(wrapper.text()).toContain('Download 37%');
  expect(wrapper.find('[aria-label="Download progress"]').attributes('value')).toBe('37');
  catalog.job.phase = 'install';
  catalog.job.downloadProgress = 100;
  catalog.job.installProgress = 62;
  window.dispatchEvent(new Event('focus')); await flush();
  expect(wrapper.text()).toContain('Install 62%');
  catalog.job.running = false;
  catalog.job.error = 'Permission denied while installing this pack.';
  window.dispatchEvent(new Event('focus')); await flush();
  expect(wrapper.text()).toContain('Permission denied while installing this pack.');
  wrapper.destroy();
});

it('omits download progress for an imported archive and explains pending elevation', async () => {
  catalog.job = {
    name: 'FISH', installDir: '/opt/viame', running: true, log: '', phase: 'elevation', localArchive: true,
  };
  const wrapper = mount(); await flush();
  expect(wrapper.find('[aria-label="Download progress"]').exists()).toBe(false);
  expect(wrapper.text()).toContain('Approve the Windows permission prompt');
  wrapper.destroy();
});
