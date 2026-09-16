import type { Api, PipelineParams } from '../apispec';
import { parseCompositeDatasetId } from '../compositeDatasetId';

export const associationCalibrationError = 'Stereo association requires a loaded calibration file.';
export const associationMulticamError = 'Detection association in multi-camera mode is not implemented yet.';
export const associationStereoDisabledError = 'Enable stereo features before associating detections.';

/** Why association cannot run, or null when it is allowed. */
export function associationUnavailableReason(
  stereo: boolean,
  calibration: boolean,
  enabled: boolean,
): string | null {
  if (!stereo) return associationMulticamError;
  if (!calibration) return associationCalibrationError;
  if (!enabled) return associationStereoDisabledError;
  return null;
}

export function validateAssociation(stereo: boolean, calibration: boolean, enabled: boolean) {
  const reason = associationUnavailableReason(stereo, calibration, enabled);
  if (reason) throw new Error(reason);
}

/** Resolve the actual camera scope; library runs may use the parent id. */
export async function singleCameraContext(
  api: Pick<Api, 'loadConfig' | 'loadDetections'>,
  datasetId: string,
) {
  const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
  const config = await api.loadConfig(parentId);
  const media = config.multiCamMedia;
  if (!media || Object.keys(media.cameras).length < 2) return null;
  const selected = cameraName || media.defaultDisplay;
  const others = Object.keys(media.cameras).filter((name) => name !== selected);
  const annotations = await Promise.all(others.map((name) => api.loadDetections(`${parentId}/${name}`)));
  return {
    parentId,
    datasetId: `${parentId}/${selected}`,
    stereo: config.subType === 'stereo',
    hasOtherTracks: annotations.some((data) => data.tracks.length > 0),
  };
}

export type SingleCameraMode = NonNullable<PipelineParams['singleCameraMode']>;

/** Remap every output id, preserving repeated track states and all other CSV fields. */
export function remapCsvIds(csv: string, maximumOtherId: number): string {
  let nextId = maximumOtherId + 1;
  const ids = new Map<string, number>();
  return csv.replace(/^(\s*\d+)(?=,)/gm, (id) => {
    const key = String(Number(id));
    if (!ids.has(key)) {
      if (!Number.isSafeInteger(nextId)) throw new Error('Track ID exceeds the supported integer range.');
      ids.set(key, nextId);
      nextId += 1;
    }
    return String(ids.get(key));
  });
}
