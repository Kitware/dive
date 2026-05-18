export interface Mousetrap {
  bind: string;
  handler: () => unknown;
}

export interface AnnotatorPreferences {
  trackTails: {
    before: number;
    after: number;
  };
  /** Display options for additional (custom) point annotations. */
  additionalPoints?: {
    showLabels: boolean;
    /** Radius scale vs default, as a percentage (50–200). */
    sizePercent: number;
  };
  lockedCamera: {
  enabled?: boolean;
  transition?: false | number;
  multiBounds?: false | number;
  };
  showUserCreatedIcon?: boolean;
}
