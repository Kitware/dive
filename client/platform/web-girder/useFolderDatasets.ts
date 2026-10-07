import type { GirderModel } from '@girder/components/src';
import {
  ref, watch, type Ref,
} from 'vue';
import { resolveFolderSelection } from './api/dataset.service';

function isDiveDatasetFolder(folder: GirderModel): boolean {
  return !!folder.meta?.annotate;
}

function asFolderModel(folder: GirderModel): GirderModel {
  return { ...folder, _modelType: 'folder' as const };
}

export type ResolveFolderDatasetsOptions = {
  /** Re-fetch every selected folder from the server (e.g. after metadata edits). */
  reload?: boolean;
};

/** Stop at datasets so camera and auxiliary folders are not separate job inputs. */
export async function resolveFolderDatasets(
  selection: GirderModel[],
  signal?: AbortSignal,
  options: ResolveFolderDatasetsOptions = {},
): Promise<GirderModel[]> {
  const folders = selection.filter((item) => item._modelType === 'folder');
  if (folders.length === 0) {
    return [];
  }

  if (options.reload) {
    const { data } = await resolveFolderSelection(folders.map(({ _id }) => _id), signal);
    const seen = new Set<string>();
    const datasets: GirderModel[] = [];
    data.forEach((folder) => {
      if (seen.has(folder._id)) {
        return;
      }
      seen.add(folder._id);
      datasets.push(folder);
    });
    return datasets;
  }

  const containerIds = folders
    .filter((folder) => !isDiveDatasetFolder(folder))
    .map(({ _id }) => _id);

  let resolvedFromContainers: GirderModel[] = [];
  if (containerIds.length > 0) {
    const { data } = await resolveFolderSelection(containerIds, signal);
    resolvedFromContainers = data;
  }

  const seen = new Set<string>();
  const datasets: GirderModel[] = [];
  folders.forEach((folder) => {
    if (!isDiveDatasetFolder(folder) || seen.has(folder._id)) {
      return;
    }
    seen.add(folder._id);
    datasets.push(asFolderModel(folder));
  });
  resolvedFromContainers.forEach((folder) => {
    if (seen.has(folder._id)) {
      return;
    }
    seen.add(folder._id);
    datasets.push(folder);
  });
  return datasets;
}

/** Clear previous inputs immediately and discard requests superseded by a new selection. */
export function useFolderDatasets(selection: Ref<GirderModel[]>) {
  const datasets = ref<GirderModel[]>([]);
  const loading = ref(false);
  const error = ref('');
  const reloadNonce = ref(0);
  const reloadRequested = ref(false);

  watch([selection, reloadNonce], async ([folders], _previous, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const reload = reloadRequested.value;
    reloadRequested.value = false;
    datasets.value = [];
    error.value = '';
    loading.value = true;
    try {
      const resolved = await resolveFolderDatasets(
        folders,
        controller.signal,
        { reload },
      );
      if (!controller.signal.aborted) datasets.value = resolved;
    } catch (err) {
      if (!controller.signal.aborted) {
        error.value = 'Unable to load sequences in the selected folders. Reselect the folders to retry.';
      }
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  }, { immediate: true, flush: 'sync' });

  function refresh() {
    if (selection.value.length === 0) {
      return;
    }
    reloadRequested.value = true;
    reloadNonce.value += 1;
  }

  return {
    datasets, loading, error, refresh,
  };
}
