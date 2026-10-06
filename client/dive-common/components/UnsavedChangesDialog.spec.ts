import { shallowMount, Wrapper } from '@vue/test-utils';
import Vue, { ComponentOptions } from 'vue';
import UnsavedChangesDialog from './UnsavedChangesDialog.vue';

interface DialogVm extends Vue {
  confirm(): Promise<boolean>;
  finish(leave: boolean): void;
  dismiss(open: boolean): void;
  saveAndLeave(): Promise<void>;
  show: boolean;
  busy: boolean;
  error: string;
}
Vue.config.ignoredElements = [/^v-/];
function mountDialog(save = vi.fn().mockResolvedValue(undefined)) {
  const wrapper = shallowMount(UnsavedChangesDialog as unknown as ComponentOptions<Vue>, { propsData: { save } }) as Wrapper<DialogVm>;
  return { wrapper, save };
}

it.each([false, true])('keeps the stay/discard choice (%s) without saving', async (leave) => {
  const { wrapper, save } = mountDialog();
  const result = wrapper.vm.confirm();
  wrapper.vm.finish(leave);
  expect(await result).toBe(leave);
  expect(save).not.toHaveBeenCalled();
  wrapper.destroy();
});

it('waits for the save to finish before allowing navigation', async () => {
  let complete!: () => void;
  const { wrapper, save } = mountDialog(vi.fn(() => new Promise<void>((resolve) => { complete = resolve; })));
  const result = wrapper.vm.confirm();
  const saving = wrapper.vm.saveAndLeave();
  expect(wrapper.vm.busy).toBe(true);
  expect(wrapper.vm.show).toBe(true);
  wrapper.vm.dismiss(false);
  expect(wrapper.vm.show).toBe(true);
  await wrapper.vm.saveAndLeave();
  expect(save).toHaveBeenCalledTimes(1);
  complete();
  await saving;
  expect(await result).toBe(true);
  expect(wrapper.vm.show).toBe(false);
  wrapper.destroy();
});

it('keeps navigation blocked on save failure and permits retry', async () => {
  const { wrapper, save } = mountDialog(vi.fn().mockRejectedValueOnce(new Error('Save failed')).mockResolvedValue(undefined));
  const result = wrapper.vm.confirm();
  await wrapper.vm.saveAndLeave();
  expect(wrapper.vm.show).toBe(true);
  expect(wrapper.vm.error).toContain('Unable to save');
  expect(wrapper.vm.busy).toBe(false);
  await wrapper.vm.saveAndLeave();
  expect(await result).toBe(true);
  expect(save).toHaveBeenCalledTimes(2);
  wrapper.destroy();
});

it('treats dismissal as staying and shares repeated navigation requests', async () => {
  const { wrapper } = mountDialog();
  const first = wrapper.vm.confirm();
  expect(wrapper.vm.confirm()).toBe(first);
  wrapper.vm.dismiss(false);
  expect(await first).toBe(false);
  const next = wrapper.vm.confirm();
  wrapper.destroy();
  expect(await next).toBe(false);
});

it.each(['saving', 'readonly'])('does not save while %s', async (prop) => {
  const { wrapper, save } = mountDialog();
  await wrapper.setProps({ [prop]: true });
  const result = wrapper.vm.confirm();
  await wrapper.vm.saveAndLeave();
  expect(save).not.toHaveBeenCalled();
  wrapper.vm.finish(false);
  expect(await result).toBe(false);
  wrapper.destroy();
});
