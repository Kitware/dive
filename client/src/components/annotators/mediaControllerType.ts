import type { Ref } from '@vue/composition-api';

/**
 * MediaController provides an interface for time and a few
 * other properties of the annotator window.
 *
 * See components/annotators/README.md for docs.
 */
export interface MediaController {
  camera: Readonly<Ref<string>>;
  currentTime: Readonly<Ref<number>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geoViewerRef: Readonly<Ref<any>>;
  playing: Readonly<Ref<boolean>>;
  frame: Readonly<Ref<number>>;
  flick: Readonly<Ref<number>>;
  filename: Readonly<Ref<string>>;
  lockedCamera: Readonly<Ref<boolean>>;
  duration: Readonly<Ref<number>>;
  volume: Readonly<Ref<number>>;
  speed: Readonly<Ref<number>>;
  maxFrame: Readonly<Ref<number>>;
  /** @deprecated may be removed in a future release */
  syncedFrame: Readonly<Ref<number>>;
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
  setVolume(v: number): void;
  setSpeed(v: number): void;
}

export interface MediaControlAggregator {
  maxFrame: Ref<number>;
   frame: Ref<number>;
   seek: (frame: number) => void;
   volume: Ref<number>;
   setVolume: (volume: number) => void;
   speed: Ref<number>;
   setSpeed: (speed: number) => void;
   lockedCamera: Ref<boolean>;
   toggleLockedCamera: (lock: boolean) => void;
   pause: () => void;
   play: () => void;
   playing: Ref<boolean>;
   nextFrame: () => void;
   prevFrame: () => void;
   resetZoom: () => void;
   duration: Ref<Record<string, number>>;
   filename: Ref<Record<string, string>>;
   currentTime: Ref<Record<string, number>>;
}
