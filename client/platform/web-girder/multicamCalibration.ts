import { calibrationFileTypes } from 'dive-common/constants';

/** Extensions accepted for stereoscopic calibration on web (matches file picker and server). */
export function isAllowedStereoCalibrationFilename(fileName: string): boolean {
  const parts = fileName.split('.');
  if (parts.length < 2) {
    return false;
  }
  const ext = parts.pop()?.toLowerCase() ?? '';
  return calibrationFileTypes.includes(ext);
}

export function stereoCalibrationAllowedExtensionsLabel(): string {
  return calibrationFileTypes.map((ext) => `.${ext}`).join(', ');
}
