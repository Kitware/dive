import type { SubType } from 'dive-common/apispec';
import { preferEoIrSubfolderOrder } from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
import { resolvePipelineCameraOrder } from 'dive-common/pipelineCameraOrder';

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
  return subType === 'stereo' ? 'Stereo dataset' : 'Multi Camera dataset';
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

/**
 * The reference camera that image registration maps onto: the Reference
 * Camera chosen in the import dialog (stored as the dataset's
 * defaultDisplay), falling back to the first camera in display order when
 * that choice is missing or names an unknown camera.
 */
export function referenceCameraName(multiCamMedia: MultiCamMediaLike | null | undefined): string | null {
  const ordered = orderedMultiCamCameraNames(multiCamMedia);
  if (!ordered.length) {
    return null;
  }
  const defaultDisplay = multiCamMedia?.defaultDisplay;
  return defaultDisplay && ordered.includes(defaultDisplay) ? defaultDisplay : ordered[0];
}

/**
 * Camera order for 2-cam/3-cam VIAME pipelines: the registration reference
 * camera feeds input1 (the per-camera registrations all map onto the
 * reference, and the pipes warp everything onto camera 1's frame), remaining
 * cameras keep display order. Which detector a pipe runs on which input is
 * the pipe's documented contract, not something DIVE infers.
 */
export function pipelineOrderedCameraNames(multiCamMedia: MultiCamMediaLike | null | undefined): string[] {
  const ordered = orderedMultiCamCameraNames(multiCamMedia);
  const reference = referenceCameraName(multiCamMedia);
  return reference ? [reference, ...ordered.filter((name) => name !== reference)] : ordered;
}

/**
 * The cameras to feed input1..N of a 2-cam/3-cam pipeline. A pipe that
 * declares its slots (`# Camera Order:` header, parsed into
 * metadata.cameraOrder) gets each slot matched to a dataset camera by name and
 * throws when that is not unambiguous; a pipe without one gets
 * {@link pipelineOrderedCameraNames}. Camera 1 is the frame the others'
 * registrations must map onto.
 */
export function pipelineCameraNames(
  multiCamMedia: MultiCamMediaLike | null | undefined,
  declaredOrder?: string[] | null,
): string[] {
  if (declaredOrder?.length) {
    const result = resolvePipelineCameraOrder(declaredOrder, orderedMultiCamCameraNames(multiCamMedia));
    if (result.error !== undefined) {
      throw new Error(result.error);
    }
    return result.order;
  }
  return pipelineOrderedCameraNames(multiCamMedia);
}

export function isMultiCamSubType(subType: SubType | string | null | undefined): subType is MultiCamSubType {
  return subType === 'stereo' || subType === 'multicam';
}

export type DatasetConfigLike = {
  type?: string;
  subType?: string;
};

export type FolderMetaLike = {
  meta?: DatasetConfigLike;
  parentId?: string | null;
  _id?: string;
};

/** True when folder meta describes a stereoscopic or multicam parent dataset. */
export function isMultiCamDatasetConfig(meta: DatasetConfigLike | null | undefined): boolean {
  return getMultiCamSubType(meta) !== null;
}

/** True when folder meta describes a stereoscopic (not plain multicam) parent dataset. */
export function isStereoscopicDatasetConfig(meta: DatasetConfigLike | null | undefined): boolean {
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
  if (folders.some((folder) => isMultiCamDatasetConfig(folder.meta))) {
    return true;
  }
  if (!browseLocation || !isMultiCamDatasetConfig(browseLocation.meta) || !browseLocation._id) {
    return false;
  }
  if (folders.length === 0) {
    return true;
  }
  return folders.every((folder) => folder.parentId === browseLocation._id);
}
