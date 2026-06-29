import type { GirderModel } from '@girder/components/src';

import {
  DatasetMetaMutable, FrameImage, SaveAttributeArgs, SaveAttributeTrackFilterArgs,
} from 'dive-common/apispec';
import { calibrationFileMarker, jsonCalibrationFileMarker } from 'dive-common/constants';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import { isStereoCalibrationFileName } from 'dive-common/stereoParentFolder';
import { GirderMetadataStatic } from 'platform/web-girder/constants';
import girderRest from 'platform/web-girder/plugins/girder';
import { resolveDatasetFolderId } from './multicamResolve';
import { postProcess } from './rpc.service';

interface HTMLFile extends File {
  webkitRelativePath?: string;
}

async function getDataset(datasetId: string) {
  const { folderId, compositeId } = await resolveDatasetFolderId(datasetId);
  const response = await girderRest.get<GirderMetadataStatic>(`dive_dataset/${folderId}`);
  if (compositeId) {
    response.data.id = compositeId;
  }
  return response;
}

async function getDatasetList(
  limit?: number,
  offset?: number,
  sort?: string,
  sortdir?: number,
  shared?: boolean,
  published?: boolean,
) {
  const response = await girderRest.get<GirderModel[]>('dive_dataset', {
    params: {
      limit,
      offset,
      sort,
      sortdir,
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
  sourceVideo?: MediaResource;
}

async function getDatasetMedia(datasetId: string) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
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

function getDatasetCalibration(datasetId: string) {
  return girderRest.get('dive_dataset/calibration', {
    params: { folderId: parentDatasetId(datasetId) },
  });
}

function createGirderFolder({
  folderId, name, description,
}: {
  folderId: string;
  name: string;
  description?: string;
}) {
  return girderRest.post<GirderModel>('/folder', null, {
    params: {
      parentId: folderId,
      name,
      description,
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

async function importAnnotationFile(parentId: string, path: string, file?: HTMLFile, additive = false, additivePrepend = '', set: string | undefined = undefined): Promise<boolean | string[]> {
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
      const final = await postProcess(parentId, true, false, additive, additivePrepend, set);
      if (final.data.warnings !== undefined) {
        const { warnings } = final.data;
        return warnings;
      }

      return final.status === 200;
    }
  }
  return false;
}

async function saveAttributes(datasetId: string, args: SaveAttributeArgs) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  return girderRest.patch(`/dive_dataset/${folderId}/attributes`, args);
}

async function saveAttributeTrackFilters(
  datasetId: string,
  args: SaveAttributeTrackFilterArgs,
) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  return girderRest.patch(`/dive_dataset/${folderId}/attribute_track_filters`, args);
}

async function saveMetadata(datasetId: string, metadata: DatasetMetaMutable) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
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

export interface CreateMulticamDatasetArgs {
  parentFolderId: string;
  name: string;
  fps: number;
  type: 'video' | 'image-sequence';
  subType: 'stereo' | 'multicam';
  defaultDisplay: string;
  cameras: Record<string, { folderId: string }>;
  cameraOrder?: string[];
  calibrationFileId?: string;
}

function createMulticamDataset(args: CreateMulticamDatasetArgs) {
  const {
    parentFolderId, name, fps, type, subType, defaultDisplay, cameras, cameraOrder, calibrationFileId,
  } = args;
  return girderRest.post<GirderModel>(
    'dive_dataset/multicam',
    {
      name,
      fps,
      type,
      subType,
      defaultDisplay,
      cameras,
      cameraOrder,
      calibrationFileId,
    },
    {
      params: { parentFolderId },
    },
  );
}

async function uploadCalibrationItem(parentFolderId: string, file: File): Promise<string> {
  const isJson = file.name.toLowerCase().endsWith('.json');
  const calibrationMeta = isJson
    ? { [calibrationFileMarker]: 'true', [jsonCalibrationFileMarker]: 'true' }
    : { [calibrationFileMarker]: 'true' };
  const itemResp = await girderRest.post<GirderModel>('/item', null, {
    params: {
      folderId: parentFolderId,
      name: file.name,
      metadata: JSON.stringify(calibrationMeta),
    },
  });
  const itemId = itemResp.data._id;
  const fileResp = await girderRest.post('/file', null, {
    params: {
      parentType: 'item',
      parentId: itemId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    },
  });
  await girderRest.post('file/chunk', file, {
    params: {
      uploadId: fileResp.data._id,
      offset: 0,
    },
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  // Girder item metadata is set via PUT item/:id/metadata (not PUT item/:id).
  await girderRest.put(`item/${itemId}/metadata`, calibrationMeta);
  return itemId;
}

function calibrationMarkerTruthy(meta: Record<string, unknown> | undefined, key: string): boolean {
  const marker = meta?.[key];
  return marker === true || marker === 'true' || marker === '1';
}

async function calibrationItemExists(itemId: string): Promise<boolean> {
  try {
    await girderRest.get(`item/${itemId}`);
    return true;
  } catch {
    return false;
  }
}

/** Remove calibration item references from the dataset folder metadata. */
async function clearCalibrationFolderMetadata(datasetId: string): Promise<void> {
  const parentId = parentDatasetId(datasetId);
  const { data: folder } = await girderRest.get<{
    meta?: { multiCam?: Record<string, unknown> };
  }>(`folder/${parentId}`);
  const multiCam = { ...(folder.meta?.multiCam ?? {}) };
  delete multiCam.calibrationItemId;
  delete multiCam.jsonCalibrationItemId;
  delete multiCam.calibrationOriginalName;
  delete multiCam.calibrationConversionError;
  await girderRest.put(`folder/${parentId}/metadata`, { multiCam });
}

async function hasCalibrationFile(datasetId: string): Promise<boolean> {
  const parentId = parentDatasetId(datasetId);
  const folder = await girderRest.get<{
    meta?: { multiCam?: { calibrationItemId?: string; jsonCalibrationItemId?: string } };
  }>(`folder/${parentId}`);
  const multiCam = folder.data.meta?.multiCam;
  const cachedIds = [multiCam?.calibrationItemId, multiCam?.jsonCalibrationItemId]
    .filter((id): id is string => !!id);
  if (cachedIds.length) {
    const existing = await Promise.all(cachedIds.map((id) => calibrationItemExists(id)));
    if (existing.some(Boolean)) {
      return true;
    }
  }
  const items = await girderRest.get<Array<{ name: string; meta?: Record<string, unknown> }>>(
    'item',
    { params: { folderId: parentId, limit: 0 } },
  );
  return items.data.some(
    (item) => (
      calibrationMarkerTruthy(item.meta, calibrationFileMarker)
      || calibrationMarkerTruthy(item.meta, jsonCalibrationFileMarker)
    ) && isStereoCalibrationFileName(item.name),
  );
}

export {
  clone,
  clearCalibrationFolderMetadata,
  createGirderFolder,
  createMulticamDataset,
  getDataset,
  getDatasetList,
  getDatasetMedia,
  hasCalibrationFile,
  getDatasetCalibration,
  importAnnotationFile,
  makeViameFolder,
  saveAttributes,
  saveAttributeTrackFilters,
  saveMetadata,
  uploadCalibrationItem,
  validateUploadGroup,
};
