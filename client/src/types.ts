export interface Mousetrap {
  bind: string;
  handler: () => unknown;
}

/** Canvas styling for attribute-suppressed detections. */
export interface SuppressionDisplaySettings {
  /** When true, apply dashed/fill/opacity styling to suppressed detections. */
  enabled: boolean;
  /** Draw a dashed outline instead of a solid one. */
  dashed: boolean;
  /** Outline opacity in [0, 1]. */
  outlineOpacity: number;
  /** Fill color hex; empty string uses the detection's type color. */
  fillColor: string;
  /** Fill opacity in [0, 1]. Fill is drawn when this is > 0. */
  fillOpacity: number;
}

export const DEFAULT_SUPPRESSION_DISPLAY: SuppressionDisplaySettings = {
  enabled: true,
  dashed: true,
  outlineOpacity: 1,
  fillColor: '',
  fillOpacity: 0.3,
};

export function resolveSuppressionDisplay(
  settings?: Partial<SuppressionDisplaySettings> | null,
): SuppressionDisplaySettings {
  return { ...DEFAULT_SUPPRESSION_DISPLAY, ...settings };
}

export interface AnnotatorPreferences {
  trackTails: {
    before: number;
    after: number;
  };
  lockedCamera: {
  enabled?: boolean;
  transition?: false | number;
  multiBounds?: false | number;
  };
  showUserCreatedIcon?: boolean;
  /** When true, annotation text labels and hover tooltips include an mdi-eye-off icon for attribute-suppressed detections. */
  showSuppressedTags?: boolean;
  /** Canvas outline/fill styling for attribute-suppressed detections. */
  suppressionDisplay?: SuppressionDisplaySettings;
}
