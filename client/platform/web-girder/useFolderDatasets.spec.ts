import {
  describe, expect, it, vi, afterEach,
} from 'vitest';
import { effectScope, ref } from 'vue';
import type { GirderModel } from '@girder/components/src';
import girderRest from './plugins/girder';
import { resolveFolderDatasets, useFolderDatasets } from './useFolderDatasets';

function folder(id: string, annotate = false): GirderModel {
  return {
    _id: id, _modelType: 'folder', name: id, meta: { annotate },
  } as unknown as GirderModel;
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(() => vi.restoreAllMocks());

describe('folder job selection', () => {
  it('walks nested containers, deduplicates selections, and stops at sequences', async () => {
    const sequence = folder('sequence', true);
    const multi = { ...folder('multi', true), meta: { annotate: true, type: 'multi' } } as GirderModel;
    const get = vi.spyOn(girderRest, 'get').mockImplementation(async (url, config) => {
      const id = config?.params.parentId;
      const children = id === 'root' ? [folder('nested'), sequence] : [multi, sequence];
      return { data: children.map((child) => ({ ...child, _modelType: undefined })) } as never;
    });
    const result = await resolveFolderDatasets([
      folder('root'), folder('nested'), sequence,
      { ...folder('item'), _modelType: 'item' },
    ]);
    expect(result.map((item) => item._id)).toEqual(['sequence', 'multi']);
    expect(get.mock.calls.map((call) => call[1]?.params.parentId)).toEqual(['root', 'nested']);
    expect(result[1].meta?.type).toBe('multi');
  });

  it('loads every page of a large folder', async () => {
    const get = vi.spyOn(girderRest, 'get').mockImplementation(async (url, config) => ({
      data: config?.params.offset === 0
        ? Array.from({ length: 100 }, (_, i) => folder(`sequence-${i}`, true))
        : [folder('last-sequence', true)],
    }) as never);
    const result = await resolveFolderDatasets([folder('root')]);
    expect(result).toHaveLength(101);
    expect(result[100]._id).toBe('last-sequence');
    expect(get.mock.calls.map((call) => call[1]?.params.offset)).toEqual([0, 100]);
  });

  it('returns no inputs for empty folders and ignores selected files', async () => {
    const get = vi.spyOn(girderRest, 'get').mockResolvedValue({ data: [] });
    expect(await resolveFolderDatasets([
      folder('empty'), { ...folder('file'), _modelType: 'item' },
    ])).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('discards a slow response after the selection changes', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.spyOn(girderRest, 'get').mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }) as never);
    const scope = effectScope();
    const selection = ref([folder('old')]);
    const state = scope.run(() => useFolderDatasets(selection))!;
    expect(state.loading.value).toBe(true);
    selection.value = [folder('new-sequence', true)];
    await flush();
    finish({ data: [folder('old-sequence', true)] });
    await flush();
    expect(state.datasets.value.map((item) => item._id)).toEqual(['new-sequence']);
    expect(state.loading.value).toBe(false);
    scope.stop();
  });

  it('clears old inputs and reports failures without exposing partial results', async () => {
    vi.spyOn(girderRest, 'get')
      .mockResolvedValueOnce({ data: [folder('sequence', true), folder('unreadable')] })
      .mockRejectedValueOnce(new Error('forbidden'));
    const scope = effectScope();
    const selection = ref([folder('previous', true)]);
    const state = scope.run(() => useFolderDatasets(selection))!;
    await flush();
    expect(state.datasets.value).toHaveLength(1);
    selection.value = [folder('root')];
    expect(state.datasets.value).toEqual([]);
    await flush();
    expect(state.datasets.value).toEqual([]);
    expect(state.error.value).toContain('Unable to load');
    expect(state.loading.value).toBe(false);
    scope.stop();
  });
});
