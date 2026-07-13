/**
 * Tooltip copy for the multicam "Align View" toolbar toggle.
 *
 * Kept pure so Viewer and unit tests share one source of truth for the
 * progressive-registration and mixed-calibration messaging.
 */
export default function alignedViewTooltipText(options: {
  isMultiCamera: boolean;
  enabled: boolean;
  sourceIsMixed: boolean;
  progress: { registered: number; total: number } | null;
}): string {
  const {
    isMultiCamera, enabled, sourceIsMixed, progress,
  } = options;
  if (!isMultiCamera) {
    return 'Align View';
  }
  // Per-camera registration files with disagreeing producer stamps mean
  // the rig may mix calibration generations -- say so instead of
  // composing silently.
  const mixedNote = sourceIsMixed
    ? ' — warning: mixed calibration file generations'
    : '';
  if (enabled) {
    return `Align View on (draw/edit on any camera)${mixedNote}`;
  }
  if (progress && progress.registered < progress.total) {
    return `Align View — ${progress.registered}/${progress.total} cameras registered${mixedNote}`;
  }
  return `Align View${mixedNote}`;
}
