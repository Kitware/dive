import type { GirderModel } from '@girder/components/src';
import restClient from '../plugins/girder';

async function getItemsInFolder(folderId: string, limit: number) {
  const { data: items } = await restClient.get('item', {
    params: { folderId, limit },
  });
  return items as GirderModel[];
}

async function getFolder(folderId: string) {
  return (await restClient.get(`folder/${folderId}`)).data as GirderModel;
}

function getItemDownloadUri(itemId: string, inline = false) {
  const contentDisposition = inline ? '?contentDisposition=inline' : '';
  return `${restClient.apiRoot}/item/${itemId}/download${contentDisposition}`;
}

export {
  restClient,
  getItemsInFolder,
  getItemDownloadUri,
  getFolder,
};
