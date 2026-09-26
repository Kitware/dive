import {
  defineComponent, h, nextTick, shallowReactive,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import ParentTypePicker from './ParentTypePicker.vue';

const Autocomplete = {
  name: 'VAutocomplete',
  props: {
    value: { type: String, default: null },
    searchInput: { type: String, default: null },
    items: { type: Array, default: () => [] },
    disabled: Boolean,
    errorMessages: { type: String, default: '' },
  },
  render: () => h('input'),
};

function mountPicker({
  value = 'current' as string | null,
  allTypes = ['leaf', 'current', 'branch'],
  excludedTypes = ['leaf'],
  disabled = false,
  errorMessage = '',
} = {}) {
  const props = shallowReactive({
    value, allTypes, excludedTypes, disabled, errorMessage,
  });
  const input = vi.fn((parent: string | null) => { props.value = parent; });
  const searchValid = vi.fn();
  const Host = defineComponent({
    setup: () => () => h(ParentTypePicker, {
      props,
      on: { input, 'search-valid': searchValid },
    }),
  });
  const wrapper = shallowMount(Host, {
    stubs: { ParentTypePicker: false, VAutocomplete: Autocomplete },
  });
  return {
    props, input, searchValid, autocomplete: wrapper.findComponent(Autocomplete),
  };
}

describe('ParentTypePicker', () => {
  it('bounds choices with the selected parent first, but searches beyond the initial 50', async () => {
    const { autocomplete, input } = mountPicker({
      allTypes: [
        'leaf',
        'current',
        ...Array.from({ length: 100 }, (_, i) => `type${i.toString().padStart(3, '0')}`),
      ],
    });
    const options = autocomplete.props('items');
    expect(options).toHaveLength(50);
    expect(options[0]).toBe('current');
    expect(options.slice(1)).toEqual([...options.slice(1)].sort());
    expect(options).not.toContain('type099');

    autocomplete.vm.$emit('update:search-input', 'TYPE099');
    await nextTick();
    expect(autocomplete.props('items')).toEqual(['current', 'type099']);
    expect(input).not.toHaveBeenCalled();
  });

  it('orders prefix matches before substring matches and excludes both edited names', async () => {
    const { autocomplete } = mountPicker({
      allTypes: ['leaf', 'fin', 'current', 'alpine', 'alpha', 'coral'],
      excludedTypes: ['leaf', 'fin'],
    });
    autocomplete.vm.$emit('update:search-input', 'al');
    await nextTick();
    expect(autocomplete.props('items')).toEqual(['current', 'alpha', 'alpine', 'coral']);
  });

  it('sorts parent choices by Unicode code point', () => {
    const privateUse = '\uE000';
    const astral = '\u{10000}';
    const { autocomplete } = mountPicker({ allTypes: ['leaf', 'current', astral, privateUse] });
    expect(autocomplete.props('items')).toEqual(['current', privateUse, astral]);
  });

  it('reports unresolved text, forwards selections, and allows clearing to top level', async () => {
    const {
      autocomplete, input, searchValid, props,
    } = mountPicker({ errorMessage: 'Type hierarchy is invalid: cycle leaf -> branch -> leaf.' });
    expect(searchValid).toHaveBeenLastCalledWith(true);
    expect(autocomplete.props('errorMessages')).toBe(props.errorMessage);

    autocomplete.vm.$emit('update:search-input', 'missing');
    await nextTick();
    expect(searchValid).toHaveBeenLastCalledWith(false);
    expect(autocomplete.props('errorMessages')).toBe(
      'Select an existing type from the list, or clear the field.',
    );
    expect(input).not.toHaveBeenCalled();

    autocomplete.vm.$emit('input', 'branch');
    await nextTick();
    expect(input).toHaveBeenLastCalledWith('branch');
    expect(autocomplete.props('searchInput')).toBe('branch');
    expect(searchValid).toHaveBeenLastCalledWith(true);
    expect(autocomplete.props('errorMessages')).toBe(props.errorMessage);

    autocomplete.vm.$emit('input', null);
    await nextTick();
    expect(input).toHaveBeenLastCalledWith(null);
    expect(autocomplete.props('value')).toBeNull();
    expect(autocomplete.props('searchInput')).toBeNull();
    expect(searchValid).toHaveBeenLastCalledWith(true);
  });

  it.each(['', null])('accepts an empty search (%s) without clearing the selected parent', async (search) => {
    const { autocomplete, input, searchValid } = mountPicker();
    autocomplete.vm.$emit('update:search-input', 'unfinished');
    await nextTick();
    autocomplete.vm.$emit('update:search-input', search);
    await nextTick();
    expect(searchValid).toHaveBeenLastCalledWith(true);
    expect(autocomplete.props('value')).toBe('current');
    expect(input).not.toHaveBeenCalled();
  });

  it('resets search on external selection changes and does not pin an excluded parent', async () => {
    const { autocomplete, props, searchValid } = mountPicker();
    autocomplete.vm.$emit('update:search-input', 'unfinished');
    await nextTick();
    props.value = 'branch';
    props.excludedTypes = ['leaf', 'branch'];
    await nextTick();
    expect(autocomplete.props('searchInput')).toBe('branch');
    expect(autocomplete.props('items')).toEqual(['current']);
    expect(searchValid).toHaveBeenLastCalledWith(true);
  });

  it('preserves autocomplete affordances and read-only state', () => {
    const { autocomplete } = mountPicker({ disabled: true });
    expect(autocomplete.props('disabled')).toBe(true);
    expect(autocomplete.attributes('auto-select-first')).toBe('');
    expect(autocomplete.attributes('no-filter')).toBe('');
    expect(autocomplete.attributes('clearable')).toBe('');
    expect(autocomplete.attributes('no-data-text')).toBe(
      'No matching type. Add it from Type Settings first.',
    );
  });
});
