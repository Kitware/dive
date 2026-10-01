import type { GirderModel } from '@girder/components/src';
import {
  ref, watch, type Ref,
} from 'vue';
import { resolveFolderSelection } from './api/dataset.service';

/** Stop at datasets so camera and auxiliary folders are not separate job inputs. */
export async function resolveFolderDatasets(
  selection: GirderModel[],
  signal?: AbortSignal,
): Promise<GirderModel[]> {
  const folderIds = selection
    .filter((item) => item._modelType === 'folder')
    .map(({ _id }) => _id);
  if (folderIds.length === 0) {
    return [];
  }
  const { data } = await resolveFolderSelection(folderIds, signal);
  return data;
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
