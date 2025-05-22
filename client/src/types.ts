export interface Mousetrap {
  bind: string;
  handler: () => unknown;
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
  }
}
