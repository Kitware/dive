import type { Pipelines, SubType } from 'dive-common/apispec';
import {
  MultiType,
  multiCamPipelineMarkers,
  stereoDatasetPipelineMarkers,
} from 'dive-common/constants';

type MultiCamMetaShape = {
  cameras?: Record<string, unknown>;
  cameraOrder?: string[];
};

/** Camera count from Girder folder meta or loaded dataset meta. */
export function getMultiCamCameraCount(meta: {
  type?: string;
  multiCam?: MultiCamMetaShape;
  multiCamMedia?: MultiCamMetaShape;
} | null | undefined): number {
  if (meta?.type !== 'multi') {
    return 1;
  }
  const storage = meta.multiCamMedia ?? meta.multiCam;
  if (!storage) {
    return 1;
  }
  const { cameras, cameraOrder } = storage;
  if (cameraOrder?.length) {
    if (cameras) {
      const ordered = cameraOrder.filter((name) => name in cameras);
      if (ordered.length > 0) {
        return ordered.length;
      }
    }
    return cameraOrder.length;
  }
  const count = cameras ? Object.keys(cameras).length : 0;
  return count > 0 ? count : 1;
}

function shouldShowMultiCamPipelineCategory(
  categoryName: string,
  subTypeList: SubType[],
  cameraNumbers: number[],
  datasetTypes?: (string | null | undefined)[],
): boolean {
  const expectedCameras = Number.parseInt(categoryName.split('-')[0], 10);
  if (!subTypeList.length || !cameraNumbers.length) {
    return false;
  }
  if (!cameraNumbers.every((count) => count === expectedCameras)) {
    return false;
  }
  // Stereoscopic datasets use measurement/stereo pipelines, not X-cam categories.
  if (subTypeList.some((item) => item === 'stereo')) {
    return false;
  }
  if (datasetTypes?.length) {
    const allMulti = datasetTypes.every((t) => t === MultiType || t === 'multi');
    if (!allMulti) {
      return false;
    }
  }
  if (expectedCameras === 3) {
    // Server only allows 3 cameras for multicam; show 3-cam when not stereo.
    return subTypeList.every((item) => item === 'multicam' || item === null);
  }
  return subTypeList.every((item) => item === 'multicam');
}

/** True when every selected dataset should use measurement / common_stereo pipelines. */
export function isStereoscopicSelection(
  subTypeList: SubType[],
  cameraNumbers: number[],
  datasetTypes?: (string | null | undefined)[],
): boolean {
  if (!subTypeList.length || !cameraNumbers.length) {
    return false;
  }
  if (subTypeList.every((item) => item === 'stereo')) {
    return true;
  }
  // Match desktop: 2-camera multi datasets without an explicit multicam subtype.
  if (subTypeList.some((item) => item === 'multicam')) {
    return false;
  }
  const allMulti = !datasetTypes?.length
    || datasetTypes.every((t) => t === MultiType || t === 'multi');
  return allMulti && cameraNumbers.every((count) => count === 2);
}

/**
 * Filter pipeline categories for the run-pipeline menu (matches desktop behavior).
 *
 * - measurement / stereo: only when every selected dataset is stereoscopic
 * - 2-cam / 3-cam: only when every selected dataset is multicam and all share that camera count
 * - other categories: always shown (except the special categories above when not applicable)
 */
export function filterPipelinesForDatasets(
  pipelines: Pipelines,
  subTypeList: SubType[],
  cameraNumbers: number[],
  datasetTypes?: (string | null | undefined)[],
): Pipelines {
  const sortedPipelines = {} as Pipelines;
  const showStereoPipelines = isStereoscopicSelection(subTypeList, cameraNumbers, datasetTypes);

  Object.entries(pipelines).forEach(([name, category]) => {
    category.pipes.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName > bName) return 1;
      if (aName < bName) return -1;
      return 0;
    });

    if (showStereoPipelines && stereoDatasetPipelineMarkers.includes(name)) {
      sortedPipelines[name] = category;
    } else if (multiCamPipelineMarkers.includes(name)
      && shouldShowMultiCamPipelineCategory(name, subTypeList, cameraNumbers, datasetTypes)) {
      sortedPipelines[name] = category;
    }
    if (!stereoDatasetPipelineMarkers.includes(name) && !multiCamPipelineMarkers.includes(name)) {
      sortedPipelines[name] = category;
    }
  });

  return sortedPipelines;
}
