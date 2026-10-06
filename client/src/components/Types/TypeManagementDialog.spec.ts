import { defineComponent, h, nextTick } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { dummyState, State } from '../../provides';
import Track from '../../track';
import TypeManagementDialog from './TypeManagementDialog.vue';

const injected = vi.hoisted(() => ({ state: undefined as State | undefined }));
vi.mock('../../provides', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../provides')>(),
  useTrackFilters: () => injected.state!.trackFilters,
  useTrackStyleManager: () => injected.state!.trackStyleManager,
  useReadOnlyMode: () => injected.state!.readOnlyMode,
}));

function mountManager() {
  const state = dummyState();
  injected.state = state;
  state.trackFilters.remove = (id) => state.cameraStore.removeTracks(id);
  const store = state.cameraStore.camMap.value.get('singleCam')!.trackStore;
  store.insert(new Track(0, {
    confidencePairs: [['parent', 0.8], ['child', 0.7]],
    features: [{ frame: 0, bounds: [0, 0, 10, 10], keyframe: true }],
  }));
  store.setEnableSorting();
  state.trackFilters.setTypeHierarchy({ child: 'parent' });
  let manager: InstanceType<typeof TypeManagementDialog> | undefined;
  const Host = defineComponent({
    setup: () => () => h(TypeManagementDialog, {
      ref: (instance) => { manager = instance as InstanceType<typeof TypeManagementDialog>; },
    }),
  });
  const wrapper = shallowMount(Host, {
    stubs: {
      TypeManagementDialog: false,
      ...Object.fromEntries([
        'v-card', 'v-card-title', 'v-card-text', 'v-card-actions', 'v-spacer',
        'v-btn', 'v-icon', 'v-text-field', 'v-simple-table', 'v-dialog',
        'v-radio-group', 'v-radio', 'v-alert', 'v-checkbox',
      ].map((tag) => [tag, true])),
    },
  });
  if (!manager) throw new Error('Manager did not mount');
  return { state, wrapper, manager };
}

it('shows unfiltered deduplicated direct and branch counts and searchable hierarchy', async () => {
  const { state, wrapper, manager } = mountManager();
  state.trackFilters.checkedTypes.value = [];
  expect(manager.rows.map(({ type, direct, total }) => ({ type, direct, total }))).toEqual([
    { type: 'parent', direct: 1, total: 1 },
    { type: 'child', direct: 1, total: 1 },
  ]);
  manager.query = 'child';
  await nextTick();
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent', 'child']);
  manager.query = 'missing';
  await nextTick();
  expect(manager.rows).toEqual([]);
  wrapper.destroy();
});

it('requires a disposition, allows cancellation, and promotes children on transfer', async () => {
  const { state, wrapper, manager } = mountManager();
  manager.requestDelete('parent');
  expect(manager.childMessage).toContain('top-level');
  expect(manager.deleteCount).toBe(1);
  manager.confirmDelete();
  expect(state.trackFilters.allTypes.value).toContain('parent');
  manager.deleting = null;
  expect(state.cameraStore.getTrack(0).confidencePairs[0][0]).toBe('parent');
  manager.requestDelete('parent');
  manager.disposition = 'unknown';
  manager.confirmDelete();
  await nextTick();
  expect(manager.deleting).toBe(null);
  expect(state.trackFilters.allTypes.value).not.toContain('parent');
  expect(state.trackFilters.allTypes.value).toContain('child');
  expect(state.cameraStore.getTrack(0).confidencePairs).toContainEqual(['unknown', 0.8]);
  wrapper.destroy();
});

it('deletes tracks only after an explicit choice and resets that choice for each type', () => {
  const { state, wrapper, manager } = mountManager();
  manager.requestDelete('parent');
  manager.disposition = 'delete';
  manager.requestDelete('child');
  expect(manager.disposition).toBe(null);
  manager.disposition = 'delete';
  manager.confirmDelete();
  expect(state.cameraStore.getTrackAll(0)).toEqual([]);
  wrapper.destroy();
});

it('guards mutations in read-only mode even with a confirmation already open', () => {
  const { state, wrapper, manager } = mountManager();
  manager.requestDelete('parent');
  manager.disposition = 'delete';
  Object.assign(state.readOnlyMode, { value: true });
  manager.confirmDelete();
  expect(state.cameraStore.getTrackAll(0)).toHaveLength(1);
  manager.deleting = null;
  manager.requestDelete('child');
  expect(manager.deleting).toBe(null);
  wrapper.destroy();
});

it('collapses branches without changing counts and restores their nested expansion state', () => {
  const { state, wrapper, manager } = mountManager();
  state.trackFilters.setTypeHierarchy({ child: 'parent', grandchild: 'child' });
  manager.toggleBranch('child');
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent', 'child']);
  manager.toggleBranch('parent');
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent']);
  expect(manager.rows[0].total).toBe(1);
  manager.toggleBranch('parent');
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent', 'child']);
  manager.expandAll();
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent', 'child', 'grandchild']);
  manager.collapseAll();
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent']);
  manager.query = 'grandchild';
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent', 'child', 'grandchild']);
  manager.toggleBranch('parent');
  manager.query = '';
  expect(manager.rows.map(({ type }) => type)).toEqual(['parent']);
  wrapper.destroy();
});

it('offers ancestor cleanup only for children, applies it, and resets it between confirmations', () => {
  const { state, wrapper, manager } = mountManager();
  manager.requestDelete('parent');
  expect(manager.hasParent).toBe(false);
  manager.requestDelete('child');
  expect(manager.hasParent).toBe(true);
  expect(manager.deleteEmptyParents).toBe(false);
  manager.deleteEmptyParents = true;
  manager.deleting = null;
  manager.requestDelete('child');
  expect(manager.deleteEmptyParents).toBe(false);
  manager.deleteEmptyParents = true;
  manager.disposition = 'delete';
  manager.confirmDelete();
  expect(state.trackFilters.allTypes.value).toEqual([]);
  wrapper.destroy();
});
