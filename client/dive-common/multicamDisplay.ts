import type { SubType } from 'dive-common/apispec';
import { preferEoIrSubfolderOrder } from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';

export type MultiCamSubType = 'stereo' | 'multicam';

export interface MultiCamMediaLike {
  cameras: Record<string, unknown>;
  cameraOrder?: string[];
  defaultDisplay: string;
}

export function getMultiCamSubType(meta: {
  type?: string;
  subType?: string;
} | null | undefined): MultiCamSubType | null {
  if (!meta || meta.type !== 'multi') {
    return null;
  }
  if (meta.subType === 'stereo' || meta.subType === 'multicam') {
    return meta.subType;
  }
  return null;
}

export function getMultiCamIcon(subType: MultiCamSubType): string {
  return subType === 'stereo' ? 'mdi-binoculars' : 'mdi-camera-burst';
}

export function getMultiCamTooltip(subType: MultiCamSubType): string {
  return subType === 'stereo' ? 'Stereoscopic dataset' : 'Multicamera dataset';
}

/** Camera names in display order (import / storage order). */
export function orderedMultiCamCameraNames(multiCamMedia: MultiCamMediaLike | null | undefined): string[] {
  if (!multiCamMedia?.cameras) {
    return [];
  }
  const { cameras, cameraOrder } = multiCamMedia;
  if (cameraOrder?.length) {
    return cameraOrder.filter((name) => name in cameras);
  }
  return preferEoIrSubfolderOrder(Object.keys(cameras));
}

export function isMultiCamSubType(subType: SubType | string | null | undefined): subType is MultiCamSubType {
  return subType === 'stereo' || subType === 'multicam';
}

export type DatasetMetaLike = {
  type?: string;
  subType?: string;
};

export type FolderMetaLike = {
  meta?: DatasetMetaLike;
  parentId?: string;
  _id?: string;
};

/** True when folder meta describes a stereoscopic or multicam parent dataset. */
export function isMultiCamDatasetMeta(meta: DatasetMetaLike | null | undefined): boolean {
  return getMultiCamSubType(meta) !== null;
}

/** True when folder meta describes a stereoscopic (not plain multicam) parent dataset. */
export function isStereoscopicDatasetMeta(meta: DatasetMetaLike | null | undefined): boolean {
  return getMultiCamSubType(meta) === 'stereo';
}

/**
 * Whether training should be disabled for the current data browser selection.
 * Covers the multicam parent, browsing inside it with no selection, and per-camera child folders.
 */
export function isMultiCamTrainingTarget(
  folders: FolderMetaLike[],
  browseLocation: FolderMetaLike | null,
): boolean {
  if (folders.some((folder) => isMultiCamDatasetMeta(folder.meta))) {
    return true;
  }
  if (!browseLocation || !isMultiCamDatasetMeta(browseLocation.meta) || !browseLocation._id) {
    return false;
  }
  if (folders.length === 0) {
    return true;
  }
  return folders.every((folder) => folder.parentId === browseLocation._id);
}
