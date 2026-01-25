import type { Ref } from 'vue';

/**
 * AggregateMediaController provides an interface for time and a few
 * other properties of all cameras in the annotator window.
 *
 * See components/annotators/README.md for docs.
 */
export interface AggregateMediaController {
  currentTime: Readonly<Ref<number>>;
  frame: Readonly<Ref<number>>;
  maxFrame: Readonly<Ref<number>>;
  playing: Readonly<Ref<boolean>>;
  speed: Readonly<Ref<number>>;
  volume: Readonly<Ref<number>>;
  cameras: Readonly<Ref<string[]>>;
  cameraSync: Readonly<Ref<boolean>>;

  pause: () => void;
  play: () => void;
  resetZoom: () => void;
  seek: (frame: number) => void;
  nextFrame: () => void;
  prevFrame: () => void;
  setVolume: (volume: number) => void;
  setSpeed: (speed: number) => void;
  getController: (cameraName: string) => MediaController;
  toggleSynchronizeCameras: (sync: boolean) => void;
}

/**
 * MediaController provides some additional camera-specific
 * functions to control an individual camera
 */
export interface MediaController extends AggregateMediaController {
  cameraName: Readonly<Ref<string>>;
  duration: Readonly<Ref<number>>;
  filename: Readonly<Ref<string>>;
  flick: Readonly<Ref<number>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geoViewerRef: Readonly<Ref<any>>;
  /** True when the GeoJS viewer is fully initialized and ready to create layers */
  ready: Readonly<Ref<boolean>>;
  /** @deprecated may be removed in a future release */
  syncedFrame: Readonly<Ref<number>>;

  centerOn(coords: { x: number; y: number; z: number }): void;
  transition(coords: { x: number; y:number}, duration: number, zoom?: number): void;
  setCursor(camera: string): void;
  setImageCursor(camera: string): void;
  resetMapDimensions(width: number, height: number, isMap?: boolean, margin?: number): void;
}
