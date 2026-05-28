import type { Pipe, Pipelines, SubType } from 'dive-common/apispec';
import {
  MultiType,
  hiddenPipelineCategories,
  multiCamPipelineMarkers,
  stereoPipelineMarker,
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
  // Stereoscopic datasets use measurement pipelines, not X-cam categories.
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

function pipelineMatchesExcludedTerm(pipe: Pipe, terms: string[]): boolean {
  const hay = `${pipe.name} ${pipe.type} ${pipe.pipe}`.toLowerCase();
  return terms.some((term) => hay.includes(term.toLowerCase()));
}

/** Remove categories or pipes whose names contain any excluded term (e.g. seagis on web). */
export function excludePipelinesMatchingTerms(
  pipelines: Pipelines,
  terms: string[],
): Pipelines {
  if (!terms.length) {
    return pipelines;
  }
  const result = {} as Pipelines;
  Object.entries(pipelines).forEach(([categoryName, category]) => {
    if (terms.some((term) => categoryName.toLowerCase().includes(term.toLowerCase()))) {
      return;
    }
    const pipes = category.pipes.filter((pipe) => !pipelineMatchesExcludedTerm(pipe, terms));
    if (pipes.length) {
      result[categoryName] = { ...category, pipes };
    }
  });
  return result;
}

/**
 * Filter pipeline categories for the run-pipeline menu (matches desktop behavior).
 *
 * - measurement: only when every selected dataset is stereoscopic
 * - 2-cam / 3-cam: only when every selected dataset is multicam and all share that camera count
 * - other categories: always shown (except the special categories above when not applicable)
 */
export function filterPipelinesForDatasets(
  pipelines: Pipelines,
  subTypeList: SubType[],
  cameraNumbers: number[],
  datasetTypes?: (string | null | undefined)[],
  excludePipelineTerms: string[] = [],
): Pipelines {
  const sortedPipelines = {} as Pipelines;
  const allStereo = subTypeList.length > 0 && subTypeList.every((item) => item === 'stereo');

  Object.entries(pipelines).forEach(([name, category]) => {
    category.pipes.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName > bName) return 1;
      if (aName < bName) return -1;
      return 0;
    });

    if (allStereo && name === stereoPipelineMarker) {
      sortedPipelines[name] = category;
    } else if (multiCamPipelineMarkers.includes(name)
      && shouldShowMultiCamPipelineCategory(name, subTypeList, cameraNumbers, datasetTypes)) {
      sortedPipelines[name] = category;
    }
    if (!hiddenPipelineCategories.includes(name)
      && name !== stereoPipelineMarker
      && !multiCamPipelineMarkers.includes(name)) {
      sortedPipelines[name] = category;
    }
  });

  return excludePipelinesMatchingTerms(sortedPipelines, excludePipelineTerms);
}
