import type { SubType } from 'dive-common/apispec';

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
  return Object.keys(cameras);
}

export function isMultiCamSubType(subType: SubType | string | null | undefined): subType is MultiCamSubType {
  return subType === 'stereo' || subType === 'multicam';
}
