import type { Ref } from '@vue/composition-api';

/**
 * MediaController provides an interface for time and a few
 * other properties of the annotator window.
 *
 * See components/annotators/README.md for docs.
 */
export interface MediaController {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geoViewerRef: Ref<any>;
  playing: Ref<boolean>;
  frame: Ref<number>;
  filename: Ref<string>;
  lockedCamera: Ref<boolean>;
  maxFrame: Ref<number>;
  /** @deprecated may be removed in a future release */
  syncedFrame: Ref<number>;
  prevFrame(): void;
  nextFrame(): void;
  play(): void;
  pause(): void;
  seek(frame: number): void;
  resetZoom(): void;
  toggleLockedCamera(): void;
  centerOn(coords: {x: number; y: number; z: number }): void;
  setCursor(c: string): void;
  setImageCursor(c: string): void;
}
