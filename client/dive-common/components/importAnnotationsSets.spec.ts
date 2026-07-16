// @vitest-environment jsdom
import { defineComponent, h, ref } from 'vue';
// eslint-disable-next-line import/no-extraneous-dependencies -- @vue/test-utils is only used in tests
import { mount } from '@vue/test-utils';
import { provideAnnotator, dummyState, dummyHandler } from 'vue-media-annotator/provides';
import { provideApi } from 'dive-common/apispec';
import ImportAnnotations from './ImportAnnotations.vue';

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: vi.fn() }),
}));

/**
 * The Import menu's contents are lazy: v-menu does not render them until the
 * menu is opened, so `sets` is first evaluated from outside a render pass.
 * inject() only resolves while a component instance is current -- which,
 * outside setup(), holds solely during render -- so resolving the annotation
 * sets inside the computed threw "Missing provided object for symbol
 * Symbol(annotationSets)" for every such caller. Mounting with the menu closed
 * reproduces that; touching `sets` here must not throw.
 */
function mountImportAnnotations(annotationSets: string[]) {
  const state = dummyState();
  state.annotationSets = ref(annotationSets);

  const Parent = defineComponent({
    setup() {
      provideApi({
        openFromDisk: vi.fn(),
        importAnnotationFile: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      provideAnnotator(
        state,
        dummyHandler(() => {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
      );
      return () => h(ImportAnnotations, { props: { datasetId: 'dataset-1' } });
    },
  });

  const wrapper = mount(Parent, {
    stubs: {
      'v-menu': true,
      'v-tooltip': true,
      'v-card': true,
      'v-btn': true,
      'v-icon': true,
    },
    mocks: { $vuetify: { breakpoint: { mdAndDown: false } } },
  });
  return wrapper.findComponent(ImportAnnotations);
}

describe('ImportAnnotations annotation sets', () => {
  it('exposes sets without requiring a render pass', () => {
    const vm = mountImportAnnotations(['setA', 'setB']);
    // Reading from outside render is what regressed: it must not throw.
    expect(() => vm.vm.sets).not.toThrow();
    expect(vm.vm.sets).toEqual(['setA', 'setB', 'default']);
  });

  it('always offers the default set when none are defined', () => {
    const vm = mountImportAnnotations([]);
    expect(vm.vm.sets).toEqual(['default']);
  });

  it('does not mutate the provided annotation sets', () => {
    const provided = ['only'];
    const vm = mountImportAnnotations(provided);
    expect(vm.vm.sets).toEqual(['only', 'default']);
    expect(provided).toEqual(['only']);
  });
});
