/**
 * Pure validation for multicam image lists: non-empty filters, equal frame counts,
 * and mutually exclusive filenames in keyword/glob mode. Video imports skip image checks.
 *
 * When `inferFrameIndexFromFilename` is set, the equal-frame-count check is skipped:
 * datasets with dropped frames (e.g. KAMERA, which encodes a capture timestamp in each
 * filename) legitimately have differing per-camera counts and are aligned downstream by
 * their filename timestamps rather than by exact positional index.
 */
export type MulticamImportType = 'multi' | 'keyword' | 'subfolders' | '';

export function validateMulticamImageSets(
  importType: MulticamImportType,
  filteredImages: Record<string, string[]>,
  globListKeyCount: number,
  dataType: string,
  inferFrameIndexFromFilename = false,
): string | null {
  if (importType === 'keyword' && globListKeyCount === 0) {
    return 'Add at least 1 filter pattern';
  }

  if (dataType === 'video') {
    return null;
  }

  const entries = Object.entries(filteredImages);
  let length = -1;
  let totalList: string[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const [cameraName, images] = entries[i];
    if (!images.length) {
      return `Requires filtered Images for ${cameraName} `;
    }
    if (length === -1) {
      length = images.length;
    }
    if (!inferFrameIndexFromFilename && length !== images.length) {
      return `All cameras should have the same length of ${length}`;
    }
    if (importType === 'keyword'
        && totalList.some((imageName) => images.includes(imageName))) {
      return 'Overlapping values.  All cameras must consist of mutually exclusive images.';
    }
    totalList = totalList.concat(images);
  }
  return null;
}
