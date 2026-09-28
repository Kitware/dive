import type { GirderModel } from '@girder/components/src';
import {
  ref, watch, type Ref,
} from 'vue';
import girderRest from './plugins/girder';

/** Stop at datasets so camera and auxiliary folders are not separate job inputs. */
export async function resolveFolderDatasets(
  selection: GirderModel[],
  signal?: AbortSignal,
): Promise<GirderModel[]> {
  const datasets: GirderModel[] = [];
  const visited = new Set<string>();
  const pending = selection.filter((item) => item._modelType === 'folder');
  const limit = 100;
  for (let index = 0; index < pending.length; index += 1) {
    const folder = pending[index];
    // eslint-disable-next-line no-continue
    if (visited.has(folder._id)) continue;
    visited.add(folder._id);
    if (folder.meta?.annotate) {
      datasets.push(folder);
      // eslint-disable-next-line no-continue
      continue;
    }
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      // Girder applies the current user's read permissions to each folder listing.
      // eslint-disable-next-line no-await-in-loop
      const { data } = await girderRest.get<GirderModel[]>('folder', {
        params: {
          parentType: 'folder', parentId: folder._id, limit, offset, sort: '_id', sortdir: 1,
        },
        signal,
      });
      pending.push(...data.map((child) => ({ ...child, _modelType: 'folder' as const })));
      offset += data.length;
      hasMore = data.length === limit;
    }
  }
  return datasets;
}

/** Clear previous inputs immediately and discard requests superseded by a new selection. */
export function useFolderDatasets(selection: Ref<GirderModel[]>) {
  const datasets = ref<GirderModel[]>([]);
  const loading = ref(false);
  const error = ref('');
  watch(selection, async (folders, previous, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    datasets.value = [];
    error.value = '';
    loading.value = true;
    try {
      const resolved = await resolveFolderDatasets(folders, controller.signal);
      if (!controller.signal.aborted) datasets.value = resolved;
    } catch (err) {
      if (!controller.signal.aborted) {
        error.value = 'Unable to load sequences in the selected folders. Reselect the folders to retry.';
      }
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  }, { immediate: true, flush: 'sync' });
  return { datasets, loading, error };
}
