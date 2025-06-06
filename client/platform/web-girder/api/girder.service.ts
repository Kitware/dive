import type { GirderModel } from '@girder/components/src';
import girderRest from 'platform/web-girder/plugins/girder';

function deleteResources(resources: Array<GirderModel>) {
  const formData = new FormData();
  formData.set(
    'resources',
    JSON.stringify({
      folder: resources
        .filter((resource) => resource._modelType === 'folder')
        .map((resource) => resource._id),
      item: resources
        .filter((resource) => resource._modelType === 'item')
        .map((resource) => resource._id),
    }),
  );
  return girderRest.delete('resource', { data: formData });
}

function getItemsInFolder(folderId: string, limit: number) {
  return girderRest.get<GirderModel[]>('item', {
    params: { folderId, limit },
  });
}

function getFolder(folderId: string) {
  return girderRest.get<GirderModel>(`folder/${folderId}`);
}

function setUsePrivateQueue(userId: string, value = false) {
  return girderRest.put<{
    user_private_queue_enabled: boolean;
  }>(`user/${userId}/use_private_queue`, null, {
    params: {
      privateQueueEnabled: value,
    },
  });
}

async function getSharedWithMeFolders(
  limit?: number,
  offset?: number,
  sort?: string,
  sortdir?: number,
  onlyNonAccessibles: boolean = true,
) {
  const response = await girderRest.get<GirderModel[]>('folder/shared-folders', {
    params: {
      limit,
      offset,
      sort,
      sortdir,
      onlyNonAccessibles,
    },
  });
  response.data.forEach((element) => {
    // eslint-disable-next-line no-param-reassign
    element._modelType = 'folder';
  });
  return response;
}

export {
  deleteResources,
  getItemsInFolder,
  getFolder,
  setUsePrivateQueue,
  getSharedWithMeFolders,
};
