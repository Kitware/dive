import type { GirderModel } from '@girder/components/src';

import { DatasetMetaMutable, FrameImage, SaveAttributeArgs } from 'dive-common/apispec';
import { GirderMetadataStatic } from 'platform/web-girder/constants';
import girderRest from 'platform/web-girder/plugins/girder';
import { postProcess } from './rpc.service';

interface HTMLFile extends File {
  webkitRelativePath?: string;
}

function getDataset(folderId: string) {
  return girderRest.get<GirderMetadataStatic>(`dive_dataset/${folderId}`);
}

async function getDatasetList(
  limit?: number,
  offset?: number,
  sort?: string,
  sortDir?: number,
  shared?: boolean,
  published?: boolean,
) {
  const response = await girderRest.get<GirderModel[]>('dive_dataset', {
    params: {
      limit,
      offset,
      sort,
      sortDir,
      shared,
      published,
    },
  });
  response.data.forEach((element) => {
    // eslint-disable-next-line no-param-reassign
    element._modelType = 'folder';
  });
  return response;
}

interface MediaResource extends FrameImage {
  id: string;
}

export interface DatasetSourceMedia {
  imageData: MediaResource[];
  video?: MediaResource;
}

function getDatasetMedia(folderId: string) {
  return girderRest.get<DatasetSourceMedia>(`dive_dataset/${folderId}/media`);
}

function clone({
  folderId, name, parentFolderId, revision,
}: {
  folderId: string;
  parentFolderId: string;
  name: string;
  revision?: number;
}) {
  return girderRest.post<GirderModel>('dive_dataset', null, {
    params: {
      cloneId: folderId, parentFolderId, name, revision,
    },
  });
}

function makeViameFolder({
  folderId, name, fps, type,
}: {
  folderId: string;
  name: string;
  fps: number;
  type: string;
}) {
  return girderRest.post(
    '/folder',
    `metadata=${JSON.stringify({
      fps,
      type,
    })}`,
    {
      params: { parentId: folderId, name },
    },
  );
}

async function importAnnotationFile(parentId: string, path: string, file?: HTMLFile) {
  if (file === undefined) {
    return false;
  }
  const resp = await girderRest.post('/file', null, {
    params: {
      parentType: 'folder',
      parentId,
      name: file.name,
      size: file.size,
      mimeType: file.type,
    },
  });
  if (resp.status === 200) {
    const uploadResponse = await girderRest.post('file/chunk', file, {
      params: {
        uploadId: resp.data._id,
        offset: 0,
      },
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (uploadResponse.status === 200) {
      const final = await postProcess(parentId, true);
      return final.status === 200;
    }
  }
  return false;
}

function saveAttributes(folderId: string, args: SaveAttributeArgs) {
  return girderRest.patch(`/dive_dataset/${folderId}/attributes`, args);
}

function saveMetadata(folderId: string, metadata: DatasetMetaMutable) {
  return girderRest.patch(`/dive_dataset/${folderId}`, metadata);
}

interface ValidationResponse {
  ok: boolean;
  type: 'video' | 'image-sequence';
  media: string[];
  annotations: string[];
  message: string;
}

function validateUploadGroup(names: string[]) {
  return girderRest.post<ValidationResponse>('dive_dataset/validate_files', names);
}


export {
  clone,
  getDataset,
  getDatasetList,
  getDatasetMedia,
  importAnnotationFile,
  makeViameFolder,
  saveAttributes,
  saveMetadata,
  validateUploadGroup,
};
