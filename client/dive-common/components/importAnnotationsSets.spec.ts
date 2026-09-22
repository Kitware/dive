import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { provideAnnotator, dummyState, dummyHandler } from 'vue-media-annotator/provides';
import { provideApi } from 'dive-common/apispec';
import ImportAnnotations from './ImportAnnotations.vue';

const promptMock = vi.fn();
vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: promptMock }),
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
function mountImportAnnotations({
  annotationSets = [],
  annotationSet = '',
  fileName,
}: {
  annotationSets?: string[];
  annotationSet?: string;
  /** File the OS picker returns for openUpload(); omit for tests that never open it. */
  fileName?: string;
} = {}) {
  const state = dummyState();
  state.annotationSets = ref(annotationSets);
  state.annotationSet = ref(annotationSet);

  const importAnnotationFile = vi.fn(async () => true);
  const openFromDisk = vi.fn(async () => ({
    canceled: fileName === undefined,
    filePaths: fileName === undefined ? [] : [fileName],
    fileList: fileName === undefined ? [] : [new File(['a'], fileName)],
  }));

  let child: InstanceType<typeof ImportAnnotations> | undefined;

  const Parent = defineComponent({
    setup() {
      provideApi({
        openFromDisk,
        importAnnotationFile,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      provideAnnotator(
        state,
        dummyHandler(() => {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
      );
      return () => h(ImportAnnotations, {
        props: { datasetId: 'dataset-1' },
        ref: (instance) => {
          if (instance && !(instance instanceof Element)) {
            child = instance as InstanceType<typeof ImportAnnotations>;
          }
        },
      });
    },
  });

  mount(Parent, {
    stubs: {
      'v-menu': true,
      'v-tooltip': true,
      'v-card': true,
      'v-btn': true,
      'v-icon': true,
    },
    mocks: { $vuetify: { breakpoint: { mdAndDown: false } } },
  });
  if (!child) {
    throw new Error('ImportAnnotations did not mount');
  }
  return { vm: child, state, importAnnotationFile };
}

describe('ImportAnnotations annotation sets', () => {
  it('exposes sets without requiring a render pass', () => {
    const { vm } = mountImportAnnotations({ annotationSets: ['setA', 'setB'] });
    // Reading from outside render is what regressed: it must not throw.
    expect(() => vm.sets).not.toThrow();
    expect(vm.sets).toEqual(['setA', 'setB', 'default']);
  });

  it('always offers the default set when none are defined', () => {
    const { vm } = mountImportAnnotations();
    expect(vm.sets).toEqual(['default']);
  });

  it('does not mutate the provided annotation sets', () => {
    const provided = ['only'];
    const { vm } = mountImportAnnotations({ annotationSets: provided });
    expect(vm.sets).toEqual(['only', 'default']);
    expect(provided).toEqual(['only']);
  });

  it('seeds currentSet from the provided annotation set, falling back to default', () => {
    expect(mountImportAnnotations().vm.currentSet).toBe('default');
    expect(mountImportAnnotations({ annotationSets: ['a'], annotationSet: 'a' }).vm.currentSet)
      .toBe('a');
  });

  it('does not alias the injected annotationSet ref', () => {
    const { vm, state } = mountImportAnnotations({ annotationSets: ['a'], annotationSet: 'a' });
    vm.currentSet = 'other';
    expect(state.annotationSet.value).toBe('a');
  });
});

/**
 * A reserved-name frame metadata attachment picked in the annotations dialog is not
 * annotations. The reject has to happen before the import call: web's importAnnotationFile
 * uploads the file and postprocesses afterwards, so anything later would leave it already in
 * the dataset folder.
 */
describe('ImportAnnotations frame metadata reject', () => {
  beforeEach(() => {
    promptMock.mockClear();
  });

  // Every reserved basename, including the JSON pair: those are never readable as frame metadata
  // but are still claimed by the name, so importing one as annotations is the same mistake.
  it.each([
    'frame-metadata.csv',
    'frame-metadata.json',
    'frame-metadata.txt',
    'frame_metadata.csv',
    'frame_metadata.json',
    'frame_metadata.txt',
    'FRAME-METADATA.CSV',
  ])('never imports %s as annotations', async (fileName) => {
    const { vm, importAnnotationFile } = mountImportAnnotations({ fileName });

    await vm.openUpload();

    expect(importAnnotationFile).not.toHaveBeenCalled();
    expect(promptMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Not an Annotation File',
    }));
  });

  it('names a remedy that exists on this platform', async () => {
    const { vm } = mountImportAnnotations({ fileName: 'frame-metadata.csv' });

    await vm.openUpload();

    const { text } = promptMock.mock.calls[0][0];
    // The creation-time picker is the one surface that accepts an attachment.
    expect(text.join(' ')).toContain('"Metadata File (Optional)"');
    // Arbitrary names work through that path, so renaming is the wrong advice.
    expect(text.join(' ')).not.toContain('rename');
  });

  it('still imports a normally named annotation file', async () => {
    const { vm, importAnnotationFile } = mountImportAnnotations({ fileName: 'tracks.csv' });

    await vm.openUpload();

    expect(importAnnotationFile).toHaveBeenCalled();
    expect(promptMock).not.toHaveBeenCalled();
  });
});
