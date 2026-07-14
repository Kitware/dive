/**
 * KAMERA flight-data format inference for multicam import.
 *
 * KAMERA writes each swathe (view) to a single flat folder -- center_view/,
 * left_view/, right_view/ -- holding the images for 1-3 modalities
 * distinguished by a filename suffix, plus sidecar metadata files
 * (e.g. metadata.json):
 *
 *   kamera_calibration_fl09_C_20240612_204107.625730_rgb.jpg
 *   kamera_calibration_fl09_C_20240612_204107.625730_ir.tif
 *   kamera_calibration_fl09_C_20240612_204107.625730_uv.jpg
 *
 * A folder is recognized as a KAMERA view folder when every image in it
 * carries a modality suffix and a parseable capture timestamp; the folder is
 * then split into one camera per modality via a per-camera filename glob
 * (MultiCamImportFolderArgs sourceList glob). Used by both the parent-folder
 * multicam import and the batch multicam scan.
 */
import { parseFrameTimestamp } from 'dive-common/frameTimestamp';

/** Canonical camera order: EO first, then IR, then UV. */
export const KameraModalities = ['rgb', 'ir', 'uv'] as const;
export type KameraModality = typeof KameraModalities[number];

const MODALITY_SUFFIX_PATTERN = /_(rgb|ir|uv)\.[^.]+$/i;

/** Modality encoded in a KAMERA filename suffix, or null when absent. */
export function parseKameraModality(fileName: string): KameraModality | null {
  const match = fileName.match(MODALITY_SUFFIX_PATTERN);
  return match ? match[1].toLowerCase() as KameraModality : null;
}

/** Filename glob selecting one modality's images within a shared view folder. */
export function kameraModalityGlob(modality: KameraModality): string {
  return `*_${modality}.*`;
}

/** True for KAMERA swathe folder names (left_view / center_view / right_view). */
export function isKameraViewFolderName(name: string): boolean {
  return /^(left|center|right)_view$/i.test(name);
}

/**
 * Modalities present when a flat image list follows the KAMERA convention:
 * non-empty, and every image has both a modality suffix and a filename
 * timestamp. Returns [] (not KAMERA) otherwise, in canonical modality order.
 */
export function detectKameraModalities(imageFileNames: string[]): KameraModality[] {
  if (!imageFileNames.length) {
    return [];
  }
  const present = new Set<KameraModality>();
  for (let i = 0; i < imageFileNames.length; i += 1) {
    const name = imageFileNames[i];
    const modality = parseKameraModality(name);
    if (!modality || parseFrameTimestamp(name) === undefined) {
      return [];
    }
    present.add(modality);
  }
  return KameraModalities.filter((modality) => present.has(modality));
}

/** Group image file names by KAMERA modality; names without a suffix are dropped. */
export function groupKameraModalities(
  imageFileNames: string[],
): Map<KameraModality, string[]> {
  const groups = new Map<KameraModality, string[]>();
  imageFileNames.forEach((name) => {
    const modality = parseKameraModality(name);
    if (!modality) {
      return;
    }
    const existing = groups.get(modality) ?? [];
    existing.push(name);
    groups.set(modality, existing);
  });
  return groups;
}

/**
 * Default dataset name for a KAMERA view folder. A bare view name is
 * ambiguous across flights, so prefix the parent (flight) folder when the
 * selected folder is a recognized view name: fl09/left_view -> fl09_left_view.
 */
export function kameraDatasetName(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  const parent = segments[segments.length - 2];
  if (parent && isKameraViewFolderName(name)) {
    return `${parent}_${name}`;
  }
  return name;
}
