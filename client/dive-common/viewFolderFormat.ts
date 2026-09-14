/**
 * Flat multi-modality view folder inference for multicam import.
 *
 * Aerial survey systems commonly write each view (swathe) to a single flat
 * folder -- named like center_view/, left_view/, right_view/ or CENT/, PORT/,
 * STBD/ -- holding the images for 1-3 modalities distinguished by a filename
 * suffix, plus sidecar metadata files (e.g. metadata.json):
 *
 *   fl09_C_20240612_204107.625730_rgb.jpg
 *   fl09_C_20240612_204107.625730_ir.tif
 *   fl09_C_20240612_204107.625730_uv.jpg
 *
 * A folder is recognized as such a view folder when every image in it carries
 * a modality suffix and a parseable capture timestamp; the folder is then
 * split into one camera per modality via a per-camera filename glob
 * (MultiCamImportFolderArgs sourceList glob). Used by both the parent-folder
 * multicam import and the batch multicam scan.
 */
import { parseFrameTimestamp } from 'dive-common/frameTimestamp';

/** Canonical camera order: EO first, then IR, then UV. */
export const Modalities = ['rgb', 'ir', 'uv'] as const;
export type Modality = typeof Modalities[number];

const MODALITY_SUFFIX_PATTERN = /_(rgb|ir|uv)\.[^.]+$/i;

/** Modality encoded in a filename suffix (_rgb / _ir / _uv), or null when absent. */
export function parseModalitySuffix(fileName: string): Modality | null {
  const match = fileName.match(MODALITY_SUFFIX_PATTERN);
  return match ? match[1].toLowerCase() as Modality : null;
}

/** Filename glob selecting one modality's images within a shared view folder. */
export function modalityGlob(modality: Modality): string {
  return `*_${modality}.*`;
}

/**
 * True for common view folder names: left_view / center_view / right_view,
 * or the port/center/starboard abbreviations PORT / CENT / STBD / STARBOARD.
 */
export function isViewFolderName(name: string): boolean {
  return /^(left|center|right)_view$/i.test(name)
    || /^(port|cent|stbd|starboard)$/i.test(name);
}

/**
 * Modalities present when a flat image list follows the view-folder
 * convention: non-empty, and every image has both a modality suffix and a
 * filename timestamp. Returns [] (not a modality folder) otherwise, in
 * canonical modality order.
 */
export function detectFolderModalities(imageFileNames: string[]): Modality[] {
  if (!imageFileNames.length) {
    return [];
  }
  const present = new Set<Modality>();
  for (let i = 0; i < imageFileNames.length; i += 1) {
    const name = imageFileNames[i];
    const modality = parseModalitySuffix(name);
    if (!modality || parseFrameTimestamp(name) === undefined) {
      return [];
    }
    present.add(modality);
  }
  return Modalities.filter((modality) => present.has(modality));
}

/** Group image file names by modality suffix; names without a suffix are dropped. */
export function groupByModality(
  imageFileNames: string[],
): Map<Modality, string[]> {
  const groups = new Map<Modality, string[]>();
  imageFileNames.forEach((name) => {
    const modality = parseModalitySuffix(name);
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
 * Default dataset name for a view folder. A bare view name is ambiguous
 * across collections, so prefix the parent folder when the selected folder is
 * a recognized view name: fl09/left_view -> fl09_left_view.
 */
export function viewFolderDatasetName(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  const parent = segments[segments.length - 2];
  if (parent && isViewFolderName(name)) {
    return `${parent}_${name}`;
  }
  return name;
}
