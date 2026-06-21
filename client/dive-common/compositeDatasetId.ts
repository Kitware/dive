export function parseCompositeDatasetId(datasetId: string): {
  parentId: string;
  cameraName: string | null;
} {
  const slash = datasetId.indexOf('/');
  if (slash === -1) {
    return { parentId: datasetId, cameraName: null };
  }
  return {
    parentId: datasetId.slice(0, slash),
    cameraName: datasetId.slice(slash + 1),
  };
}

/** Parent dataset id for multicam/stereo jobs, with or without a camera suffix. */
export function parentDatasetId(datasetId: string): string {
  return parseCompositeDatasetId(datasetId).parentId;
}
