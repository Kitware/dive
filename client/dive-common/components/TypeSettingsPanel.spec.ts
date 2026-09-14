import {
  defineComponent, h, nextTick, reactive,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import { clientSettings } from 'dive-common/store/settings';
import TypeSettingsPanel from './TypeSettingsPanel.vue';

interface PanelProps {
  allTypes: string[];
  hierarchyActive: boolean;
}

/**
 * `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
 * SFC is not, so the panel is rendered from a host and left unstubbed to keep shallow
 * semantics for its own children. The host also stands in for `setProps`.
 */
function mountPanel(props: PanelProps) {
  const state = reactive(props);
  const Host = defineComponent({
    setup: () => () => h(TypeSettingsPanel, { props: state }),
  });
  const wrapper = shallowMount(Host, { stubs: { TypeSettingsPanel: false } });
  const setProps = async (next: Partial<PanelProps>) => {
    Object.assign(state, next);
    await nextTick();
  };
  return { wrapper, setProps };
}

describe('TypeSettingsPanel hierarchy state', () => {
  afterEach(() => {
    clientSettings.typeSettings.preventCascadeTypes = false;
  });

  it('disables Prevent Cascade with exact help while preserving its saved value', async () => {
    clientSettings.typeSettings.preventCascadeTypes = true;
    const { wrapper, setProps } = mountPanel({ allTypes: ['fish'], hierarchyActive: true });
    const preventSwitch = () => wrapper.findAll('v-switch').wrappers.find(
      (item) => item.attributes('label') === 'Prevent Cascade Types',
    );

    expect(preventSwitch()?.attributes('disabled')).toBe('true');
    expect(wrapper.text()).toContain(
      'Not applicable to hierarchical types; DIVE selects the deepest qualifying type.',
    );
    expect(clientSettings.typeSettings.preventCascadeTypes).toBe(true);

    await setProps({ hierarchyActive: false });
    expect(preventSwitch()?.attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('Not applicable to hierarchical types');
    expect(clientSettings.typeSettings.preventCascadeTypes).toBe(true);

    await setProps({ hierarchyActive: true });
    expect(preventSwitch()?.attributes('disabled')).toBe('true');
    expect(clientSettings.typeSettings.preventCascadeTypes).toBe(true);
  });

  it('leaves the other type settings enabled', () => {
    const { wrapper } = mountPanel({ allTypes: [], hierarchyActive: true });
    const switches = wrapper.findAll('v-switch').wrappers;
    ['Show Empty', 'Lock Types', 'Filter Types by Frame', 'Show Max Count Button'].forEach(
      (label) => expect(switches.find((item) => item.attributes('label') === label)
        ?.attributes('disabled')).toBeUndefined(),
    );
  });
});
