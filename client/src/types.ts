export interface Mousetrap {
  bind: string;
  handler: () => unknown;
}

export interface AnnotatorPreferences {
  trackTails: {
    before: number;
    after: number;
  };
}

export interface SVGFilters {
  brightness?: number;
  intercept?: number;
}
