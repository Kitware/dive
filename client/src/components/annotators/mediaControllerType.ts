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
  maxFrame: Ref<number>;
  syncedFrame: Ref<number>;
  prevFrame(): void;
  nextFrame(): void;
  play(): void;
  pause(): void;
  seek(frame: number): void;
  resetZoom(): void;
  setCursor(c: string): void;
  setImageCursor(c: string): void;
}
