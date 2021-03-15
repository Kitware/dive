import type { GirderModel } from '@girder/components';
import girderRest from '../plugins/girder';

async function getItemsInFolder(folderId: string, limit: number) {
  const { data: items } = await girderRest.get('item', {
    params: { folderId, limit },
  });
  return items as GirderModel[];
}

async function getFolder(folderId: string) {
  return (await girderRest.get(`folder/${folderId}`)).data as GirderModel;
}

function getItemDownloadUri(itemId: string, inline = false) {
  const contentDisposition = inline ? '?contentDisposition=inline' : '';
  return `${girderRest.apiRoot}/item/${itemId}/download${contentDisposition}`;
}

export {
  getItemsInFolder,
  getItemDownloadUri,
  getFolder,
};
