import { parseCompositeDatasetId, parentDatasetId } from 'dive-common/compositeDatasetId';
import girderRest from 'platform/web-girder/plugins/girder';

export { parseCompositeDatasetId, parentDatasetId };

interface MultiCamCameraMeta {
  folderId: string;
  type?: string;
}

interface MultiCamStorageMeta {
  defaultDisplay: string;
  cameras: Record<string, MultiCamCameraMeta>;
}

export interface ResolvedDatasetId {
  folderId: string;
  compositeId: string | null;
}

const multiCamMetaCache = new Map<string, MultiCamStorageMeta>();

async function fetchMultiCamMeta(parentId: string): Promise<MultiCamStorageMeta> {
  const cached = multiCamMetaCache.get(parentId);
  if (cached) {
    return cached;
  }
  const response = await girderRest.get<{ meta?: { multiCam?: MultiCamStorageMeta } }>(
    `folder/${parentId}`,
  );
  const multiCam = response.data.meta?.multiCam;
  if (!multiCam?.cameras || !multiCam.defaultDisplay) {
    throw new Error(`Dataset ${parentId} is missing multiCam metadata`);
  }
  multiCamMetaCache.set(parentId, multiCam);
  return multiCam;
}

export async function resolveDatasetFolderId(datasetId: string): Promise<ResolvedDatasetId> {
  const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
  if (!cameraName) {
    return { folderId: parentId, compositeId: null };
  }
  const multiCam = await fetchMultiCamMeta(parentId);
  const camera = multiCam.cameras[cameraName];
  if (!camera?.folderId) {
    throw new Error(`Unknown camera "${cameraName}" for dataset ${parentId}`);
  }
  return { folderId: camera.folderId, compositeId: datasetId };
}

export function clearMultiCamMetaCache(parentId?: string): void {
  if (parentId) {
    multiCamMetaCache.delete(parentId);
  } else {
    multiCamMetaCache.clear();
  }
}

/** Review a whole rig even when entered from a camera folder or viewer link. */
export async function resolveReviewDatasetId(datasetId: string): Promise<string> {
  const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
  if (cameraName) return parentId;
  const { data: folder } = await girderRest.get<{
    parentId?: string;
    parentCollection?: string;
    meta?: { type?: string };
  }>(`folder/${datasetId}`);
  if (folder.meta?.type === 'multi' || folder.parentCollection !== 'folder' || !folder.parentId) {
    return datasetId;
  }
  const { data: parent } = await girderRest.get<{
    meta?: { type?: string; multiCam?: MultiCamStorageMeta };
  }>(`folder/${folder.parentId}`);
  const cameras = parent.meta?.multiCam?.cameras;
  // Only registered cameras belong to the sequence.
  return parent.meta?.type === 'multi'
    && Object.values(cameras ?? {}).some((camera) => camera.folderId === datasetId)
    ? folder.parentId : datasetId;
}
