import type { GirderModel } from '@girder/components/src';

import CameraRegistrationStore from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import {
  registrationValuesSummary, filterRegistrationValues, mergeRegistrationValues,
} from 'vue-media-annotator/alignedView/cameraRegistrationFiles';
import {
  DatasetMetaMutable, DatasetType, FrameImage, FrameMetadataSourcesResponse,
  SaveAttributeArgs, SaveAttributeTrackFilterArgs,
} from 'dive-common/apispec';
import { calibrationFileMarker, jsonCalibrationFileMarker } from 'dive-common/constants';
import { attachFrameTimestamps } from 'dive-common/frameTimestamp';
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
  // Parse per-frame capture timestamps client-side (single shared implementation
  // with desktop; see dive-common/frameTimestamp.ts). The girder server no longer
  // does this, so multicam per-camera frames arrive without timestamps.
  Object.values(response.data.multiCamMedia?.cameras ?? {}).forEach(
    (camera) => attachFrameTimestamps(camera.imageData),
  );
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
  const response = await girderRest.get<DatasetSourceMedia>(`dive_dataset/${folderId}/media`);
  // Parse per-frame capture timestamps client-side (see getDataset above).
  attachFrameTimestamps(response.data.imageData ?? []);
  return response;
}

interface FrameMetadataSourceItem {
  itemId: string;
  name: string;
}

interface FrameMetadataSourceItemsResponse {
  cameras: Record<string, FrameMetadataSourceItem[]>;
}

async function getFrameMetadataSourceItems(datasetId: string): Promise<FrameMetadataSourceItemsResponse> {
  const folderId = parentDatasetId(datasetId);
  const { data } = await girderRest.get<FrameMetadataSourceItemsResponse>(
    `dive_dataset/${folderId}/frame_metadata_sources`,
  );
  return data;
}

/**
 * Download a Girder item's raw bytes as text over the existing item-download route. Used by the
 * web frame-metadata read path to hand sidecar text to the shared parser. The axios JSON
 * transform is disabled so a numeric-heavy CSV/TXT is returned verbatim, never coerced.
 */
async function downloadItemText(itemId: string): Promise<string> {
  const { data } = await girderRest.get<string>(`item/${itemId}/download`, {
    responseType: 'text',
    transformResponse: [(value: string) => value],
  });
  return typeof data === 'string' ? data : String(data);
}

async function loadFrameMetadata(datasetId: string): Promise<FrameMetadataSourcesResponse> {
  const response = await getFrameMetadataSourceItems(datasetId);
  const textByItemId = new Map<string, Promise<string>>();
  const cameraEntries = await Promise.all(
    Object.entries(response.cameras ?? {}).map(async ([camera, items]) => {
      const sources = await Promise.all(
        items.map(async (item) => {
          let pending = textByItemId.get(item.itemId);
          if (pending === undefined) {
            pending = downloadItemText(item.itemId);
            textByItemId.set(item.itemId, pending);
          }
          return { name: item.name, text: await pending };
        }),
      );
      return [camera, sources] as const;
    }),
  );
  return { cameras: Object.fromEntries(cameraEntries) };
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

/**
 * Merge a DIVE registration .json into an existing multicam dataset's saved
 * camera registration. Parsing, validation, and
 * merging all happen client-side; the result persists through the standard
 * dataset meta PATCH (the calibration fields are allowlisted server-side).
 * options.camera keeps only the file's pairs naming that camera; each
 * imported pair replaces that pair wholly and other pairs are kept.
 */
async function importCameraRegistration(
  datasetId: string,
  path: string,
  file?: File,
  options: { camera?: string } = {},
) {
  if (!file) {
    throw new Error('No registration file provided');
  }
  // A throwaway store instance provides the shared parser/validator.
  const store = new CameraRegistrationStore();
  store.loadRegistrationText(await file.text());
  let incoming = {
    homographies: store.homographies.value,
    correspondences: store.correspondences.value,
    transformTypes: store.transformTypes.value,
    source: store.source.value,
  };
  if (options.camera !== undefined) {
    incoming = filterRegistrationValues(incoming, options.camera);
  }
  const summary = registrationValuesSummary(incoming);
  if (!summary.pairCount) {
    throw new Error(options.camera !== undefined
      ? `File has no pairs for camera "${options.camera}"`
      : 'File has no pairs');
  }
  const parentId = parentDatasetId(datasetId);
  const { data: current } = await getDataset(parentId);
  const merged = mergeRegistrationValues(
    {
      homographies: current.cameraHomographies ?? {},
      correspondences: current.cameraCorrespondences ?? {},
      transformTypes: current.cameraTransformTypes ?? {},
      source: current.cameraRegistrationSource ?? null,
    },
    incoming,
    file.name,
  );
  await saveMetadata(parentId, {
    cameraHomographies: merged.homographies,
    cameraCorrespondences: merged.correspondences,
    cameraTransformTypes: merged.transformTypes,
    cameraRegistrationSource: merged.source,
  });
  return summary;
}

export interface ValidatedUploadRoleMap {
  media: string[];
  annotations: string[];
  datasetConfig: string[];
  frameMetadata: string[];
}

export interface IgnoredUploadFile {
  name: string;
  reason: string;
}

export interface ValidationResponse {
  ok: boolean;
  // Empty string when validation fails (no single media type could be determined).
  type: DatasetType | '';
  message: string;
  roles: ValidatedUploadRoleMap;
  upload: string[];
  ignored: IgnoredUploadFile[];
}

function validateUploadGroup(names: string[]) {
  return girderRest.post<ValidationResponse>('dive_dataset/validate_files', names);
}

export interface CreateMulticamDatasetArgs {
  parentFolderId: string;
  name: string;
  fps: number;
  type: 'video' | 'image-sequence' | 'large-image';
  subType: 'stereo' | 'multicam';
  defaultDisplay: string;
  cameras: Record<string, { folderId: string; type?: 'video' | 'image-sequence' | 'large-image' }>;
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
  loadFrameMetadata,
  hasCalibrationFile,
  getDatasetCalibration,
  importAnnotationFile,
  importCameraRegistration,
  makeViameFolder,
  saveAttributes,
  saveAttributeTrackFilters,
  saveMetadata,
  uploadCalibrationItem,
  validateUploadGroup,
};
