// @vitest-environment jsdom
/// <reference types="vitest" />
import {
  defineComponent, h, reactive,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import TypeItem from './TypeItem.vue';

function mountTypeItem(props: Record<string, unknown>) {
  const state = reactive(props);
  const toggleExpanded = vi.fn();
  let child: InstanceType<typeof TypeItem> | undefined;
  const Host = defineComponent({
    setup: () => () => h(TypeItem, {
      props: state,
      on: { toggleExpanded },
      ref: (instance) => {
        if (instance && !(instance instanceof Element)) {
          child = instance as InstanceType<typeof TypeItem>;
        }
      },
    }),
  });
  const wrapper = shallowMount(Host, {
    stubs: {
      TypeItem: false,
      VTooltip: {
        template: '<div><slot name="activator" :on="{}" :attrs="{}" /><slot /></div>',
      },
    },
  });
  if (!child) {
    throw new Error('TypeItem did not mount');
  }
  return { wrapper, vm: child, toggleExpanded };
}

describe('TypeItem hierarchy row', () => {
  it('exposes hierarchy semantics and keeps the type color active while indeterminate', async () => {
    const { wrapper, vm, toggleExpanded } = mountTypeItem({
      type: 'fish',
      displayText: '1 / 3\u00A0 fish',
      confidenceFilterNum: 0.4,
      color: '#abc',
      checked: false,
      indeterminate: true,
      tree: true,
      depth: 2,
      hasChildren: true,
      expanded: true,
      width: 300,
      displayMaxButton: true,
      disabled: true,
      isSuppressionType: true,
      suppressionThreshold: 80,
    });

    const row = wrapper.find('v-row');
    expect(row.attributes()).toEqual(expect.objectContaining({
      role: 'listitem',
      'aria-level': '3',
    }));
    expect(row.attributes('aria-expanded')).toBeUndefined();
    const disclosure = wrapper.find('[aria-label="Collapse descendants of fish"]');
    expect(disclosure.exists()).toBe(true);
    expect(disclosure.element.tagName).toBe('BUTTON');
    expect((disclosure.element as HTMLButtonElement).tabIndex).toBe(0);
    expect(disclosure.attributes('type')).toBe('button');
    expect(disclosure.attributes('aria-expanded')).toBe('true');
    await disclosure.trigger('click');
    expect(toggleExpanded).toHaveBeenCalledTimes(1);

    const checkbox = wrapper.find('v-checkbox');
    expect(checkbox.attributes()).toEqual(expect.objectContaining({
      'input-value': 'true',
      indeterminate: 'true',
      color: '#abc',
      disabled: 'true',
    }));
    expect(vm.cssVars)
      .toEqual(expect.objectContaining({
        '--content-width': '162px',
        '--tree-depth': '24px',
      }));
    expect(wrapper.find('.row-help').exists()).toBe(false);
  });

  it('keeps flat rows free of hierarchy roles, disclosure controls, and tree spacing', () => {
    const { wrapper, vm } = mountTypeItem({
      type: 'fish',
      displayText: '1 / 3\u00A0 fish',
      confidenceFilterNum: 0,
      color: '#abc',
      checked: true,
      width: 300,
    });

    expect(wrapper.find('v-row').attributes('role')).toBeUndefined();
    expect(wrapper.find('[aria-label*="descendants of fish"]').exists()).toBe(false);
    expect(wrapper.find('v-checkbox').attributes('indeterminate')).toBeUndefined();
    expect(wrapper.find('.tree-prefix').exists()).toBe(false);
    expect(wrapper.find('v-checkbox').classes()).toContain('pl-2');
    expect(wrapper.find('v-row').classes()).not.toContain('tree-row');
    expect(vm.cssVars).toEqual({ '--content-width': '224px', '--tree-depth': '0px' });
  });

  it.each([
    [0, '0px', '216px'],
    [1, '12px', '204px'],
    [3, '36px', '180px'],
  ])('indents a depth %i tree row by the shared step and budgets the label to match', (
    depth,
    treeDepth,
    contentWidth,
  ) => {
    const { wrapper, vm } = mountTypeItem({
      type: 'fish',
      displayText: '1 / 3\u00A0 fish',
      confidenceFilterNum: 0,
      color: '#abc',
      checked: true,
      tree: true,
      depth,
      width: 300,
    });

    expect(vm.cssVars).toEqual({ '--content-width': contentWidth, '--tree-depth': treeDepth });
    expect(wrapper.find('.tree-prefix').exists()).toBe(true);
    expect(wrapper.find('v-checkbox').classes()).not.toContain('pl-2');
    expect(wrapper.find('v-row').classes()).toContain('tree-row');
  });

  it('uses an indentation spacer while search forces a parent open', () => {
    const { wrapper } = mountTypeItem({
      type: 'fish',
      displayText: '1 / 3\u00A0 fish',
      confidenceFilterNum: 0,
      color: '#abc',
      checked: true,
      tree: true,
      hasChildren: true,
      expanded: true,
      disclosureVisible: false,
    });

    expect(wrapper.find('[aria-label="Collapse descendants of fish"]').exists()).toBe(false);
    expect(wrapper.find('.tree-disclosure-spacer').exists()).toBe(true);
  });
});
