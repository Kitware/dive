import {
  describe, expect, it, vi, afterEach,
} from 'vitest';
import { effectScope, ref } from 'vue';
import type { GirderModel } from '@girder/components/src';
import type { AxiosResponse } from 'axios';
import * as datasetService from './api/dataset.service';
import { resolveFolderDatasets, useFolderDatasets } from './useFolderDatasets';

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} } as AxiosResponse<T>['config'],
  };
}

function folder(id: string, annotate = false): GirderModel {
  return {
    _id: id, _modelType: 'folder', name: id, meta: { annotate },
  } as unknown as GirderModel;
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(() => vi.restoreAllMocks());

describe('folder job selection', () => {
  it('uses selected dive datasets locally and resolves only containers', async () => {
    const sequence = folder('sequence', true);
    const multi = { ...folder('multi', true), meta: { annotate: true, type: 'multi' } } as GirderModel;
    const resolve = vi.spyOn(datasetService, 'resolveFolderSelection')
      .mockResolvedValue(axiosResponse([multi]));
    const result = await resolveFolderDatasets([
      folder('root'), folder('nested'), sequence,
      { ...folder('item'), _modelType: 'item' },
    ]);
    expect(result.map((item) => item._id)).toEqual(['sequence', 'multi']);
    expect(resolve).toHaveBeenCalledWith(['root', 'nested'], undefined);
    expect(result[1].meta?.type).toBe('multi');
  });

  it('does not call resolve when every selected folder is already a dive dataset', async () => {
    const sequence = folder('sequence', true);
    const resolve = vi.spyOn(datasetService, 'resolveFolderSelection');
    const result = await resolveFolderDatasets([sequence]);
    expect(result).toEqual([{ ...sequence, _modelType: 'folder' }]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('reloads selected folders from the server when metadata may have changed', async () => {
    const sequence = folder('sequence', true);
    const refreshed = { ...folder('sequence', true), meta: { annotate: true, trainingSplit: 'test' } };
    const resolve = vi.spyOn(datasetService, 'resolveFolderSelection')
      .mockResolvedValue(axiosResponse([refreshed]));
    const result = await resolveFolderDatasets([sequence], undefined, { reload: true });
    expect(resolve).toHaveBeenCalledWith(['sequence'], undefined);
    expect(result[0].meta?.trainingSplit).toBe('test');
  });

  it('returns no inputs when only files are selected', async () => {
    const resolve = vi.spyOn(datasetService, 'resolveFolderSelection');
    expect(await resolveFolderDatasets([
      { ...folder('file'), _modelType: 'item' },
    ])).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('discards a slow response after the selection changes', async () => {
    let finish: (value: AxiosResponse<GirderModel[]>) => void = () => {};
    let callCount = 0;
    vi.spyOn(datasetService, 'resolveFolderSelection').mockImplementation(
      () => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise((resolve) => {
            finish = resolve;
          }) as ReturnType<typeof datasetService.resolveFolderSelection>;
        }
        return Promise.resolve(axiosResponse([folder('new-sequence', true)]));
      },
    );
    const scope = effectScope();
    const selection = ref([folder('old')]);
    const state = scope.run(() => useFolderDatasets(selection))!;
    expect(state.loading.value).toBe(true);
    selection.value = [folder('new-sequence', true)];
    await flush();
    finish(axiosResponse([folder('old-sequence', true)]));
    await flush();
    expect(state.datasets.value.map((item) => item._id)).toEqual(['new-sequence']);
    expect(state.loading.value).toBe(false);
    scope.stop();
  });

  it('clears old inputs and reports failures without exposing partial results', async () => {
    const resolve = vi.spyOn(datasetService, 'resolveFolderSelection')
      .mockRejectedValueOnce(new Error('forbidden'));
    const scope = effectScope();
    const selection = ref([folder('previous', true)]);
    const state = scope.run(() => useFolderDatasets(selection))!;
    await flush();
    expect(state.datasets.value).toHaveLength(1);
    expect(resolve).not.toHaveBeenCalled();
    selection.value = [folder('root')];
    expect(state.datasets.value).toEqual([]);
    await flush();
    expect(state.datasets.value).toEqual([]);
    expect(state.error.value).toContain('Unable to load');
    expect(state.loading.value).toBe(false);
    scope.stop();
  });

  it('refresh re-resolves the current selection from the server', async () => {
    const sequence = folder('sequence', true);
    const refreshed = { ...folder('sequence', true), meta: { annotate: true, trainingSplit: 'validation' } };
    const resolve = vi.spyOn(datasetService, 'resolveFolderSelection')
      .mockResolvedValue(axiosResponse([refreshed]));
    const scope = effectScope();
    const selection = ref([sequence]);
    const state = scope.run(() => useFolderDatasets(selection))!;
    await flush();
    expect(state.datasets.value[0].meta?.trainingSplit).toBeUndefined();
    state.refresh();
    await flush();
    expect(resolve).toHaveBeenCalledWith(['sequence'], expect.any(AbortSignal));
    expect(state.datasets.value[0].meta?.trainingSplit).toBe('validation');
    scope.stop();
  });
});
