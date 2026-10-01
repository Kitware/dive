import type { VueConstructor } from 'vue';
import { shallowMount } from '@vue/test-utils';
import EditorMenu from './EditorMenu.vue';
import HeadTail from '../recipes/headtail';

function mountMenu(props = {}) {
  return shallowMount(EditorMenu as unknown as VueConstructor, {
    propsData: {
      editingTrack: false,
      editingMode: false,
      editingDetails: 'disabled',
      visibleModes: ['rectangle'],
      recipes: [],
      ...props,
    },
    directives: { mousetrap: () => {} },
  });
}

describe('annotation toolbar', () => {
  it('offers rectangle creation without selecting a track', () => {
    const wrapper = mountMenu();
    const vm = wrapper.vm as unknown as InstanceType<typeof EditorMenu>;
    expect(vm.creatingAnnotation).toBe(true);
    expect(vm.toolsDisabled).toBe(false);
    expect(vm.toolTitle(vm.editButtons[0])).toBe('Create annotation: Rectangle');
    vm.editButtons[0].click();
    expect(wrapper.emitted('set-annotation-state')).toEqual([[{ editing: 'rectangle' }]]);
    wrapper.destroy();
  });

  it('shows editing tools when a track is selected but not yet being edited', () => {
    const wrapper = mountMenu({ hasSelectedTrack: true });
    const vm = wrapper.vm as unknown as InstanceType<typeof EditorMenu>;
    expect(vm.creatingAnnotation).toBe(false);
    expect(vm.toolsDisabled).toBe(false);
    expect(vm.toolTitle(vm.editButtons[0])).toBe('Rectangle');
    wrapper.destroy();
  });

  it.each(['disabled', 'multiSelectActive', 'groupEditActive', 'lassoModeActive'])('blocks tool clicks and shortcuts while %s', (prop) => {
    const recipe = new HeadTail();
    const activate = vi.spyOn(recipe, 'activate');
    const wrapper = mountMenu({ [prop]: true, recipes: [recipe] });
    const vm = wrapper.vm as unknown as InstanceType<typeof EditorMenu>;
    expect(vm.toolsDisabled).toBe(true);
    vm.editButtons.forEach((button) => button.click());
    vm.mousetrap.forEach((shortcut) => shortcut.handler());
    expect(wrapper.emitted('set-annotation-state')).toBeUndefined();
    expect(activate).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it('opens text query without creating an empty annotation', async () => {
    const wrapper = mountMenu({ textQueryEnabled: true, textQueryAvailable: true });
    const vm = wrapper.vm as unknown as InstanceType<typeof EditorMenu>;
    vm.editButtons.find((button) => button.id === 'Text Query')!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('text-query-init')).toHaveLength(1);
    expect(wrapper.emitted('set-annotation-state')).toBeUndefined();
    expect(vm.textQueryDialogOpen).toBe(true);
    wrapper.destroy();
  });
});
