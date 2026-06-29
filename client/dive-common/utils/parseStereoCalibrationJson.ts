import type { CameraCalibration, DatasetStereoCalibration } from 'dive-common/apispec';

function optionalCalibrationNumber(
  data: Record<string, number | number[]>,
  key: string,
): number | undefined {
  const value = data[key];
  return value === undefined || value === null ? undefined : value as number;
}

function parseCameraCalibration(
  data: Record<string, number | number[]>,
  side: 'left' | 'right',
): CameraCalibration {
  const calib: CameraCalibration = {};
  const fields: [string, keyof CameraCalibration][] = [
    [`cx_${side}`, 'cx'],
    [`cy_${side}`, 'cy'],
    [`fx_${side}`, 'fx'],
    [`fy_${side}`, 'fy'],
    [`k1_${side}`, 'k1'],
    [`k2_${side}`, 'k2'],
    [`k3_${side}`, 'k3'],
    [`p1_${side}`, 'p1'],
    [`p2_${side}`, 'p2'],
  ];
  fields.forEach(([jsonKey, field]) => {
    const value = optionalCalibrationNumber(data, jsonKey);
    if (value !== undefined) {
      calib[field] = value;
    }
  });
  const rmsError = optionalCalibrationNumber(data, `rms_error_${side}`);
  if (rmsError !== undefined) {
    calib.rmsError = rmsError;
  }
  return calib;
}

/**
 * Parse a KWIVER/VIAME JSON camera-rig file into DatasetStereoCalibration.
 * Mirrors server/dive_utils/calibration_format.py:parse_stereo_calibration_json.
 */
export default function parseStereoCalibrationJson(
  data: Record<string, number | number[]>,
): DatasetStereoCalibration {
  const result: DatasetStereoCalibration = {
    R: data.R as number[],
    T: data.T as number[],
    calibrations: {
      left: parseCameraCalibration(data, 'left'),
      right: parseCameraCalibration(data, 'right'),
    },
  };
  const optionalFields: [string, keyof DatasetStereoCalibration][] = [
    ['grid_height', 'gridHeight'],
    ['grid_width', 'gridWidth'],
    ['image_height', 'imageHeight'],
    ['image_width', 'imageWidth'],
    ['square_size_mm', 'squareSize'],
    ['rms_error_stereo', 'rmsError'],
  ];
  optionalFields.forEach(([jsonKey, field]) => {
    const value = optionalCalibrationNumber(data, jsonKey);
    if (value !== undefined) {
      const parsed = (field.startsWith('grid') || field.startsWith('image'))
        ? Math.trunc(value)
        : value;
      (result as Record<string, unknown>)[field] = parsed;
    }
  });
  return result;
}
