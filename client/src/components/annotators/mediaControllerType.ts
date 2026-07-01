import type { Ref } from 'vue';

/**
 * Supplied by Viewer.vue when every camera in a multicam dataset has a
 * timestamp on every frame (see dive-common/alignedTimeline.ts). Translates
 * a global aligned-timeline slot into each camera's own local frame index,
 * or undefined for a camera with no frame at that slot. Absent (null)
 * whenever alignment isn't possible/applicable -- including always for
 * single-camera datasets -- in which case playback falls back to today's
 * exact positional (broadcast-same-index) behavior.
 */
export interface AlignedFrameResolver {
  slotCount: Readonly<Ref<number>>;
  frameRate: Readonly<Ref<number>>;
  resolveSlot: (globalFrame: number) => Record<string, number | undefined>;
}

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
  /** Incremented when the viewer is resized, used to trigger layer redraws */
  resizeTrigger: Readonly<Ref<number>>;

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
  /** @deprecated may be removed in a future release */
  syncedFrame: Readonly<Ref<number>>;
  /**
   * False when an aligned-timeline slot has no frame for this camera (see
   * AlignedFrameResolver) -- the pane is blank and LayerManager should not
   * draw annotations for the stale `frame` value left over from before.
   */
  hasFrame: Readonly<Ref<boolean>>;
  /**
   * Per-camera seek accepts undefined when this camera has no frame at the
   * current aligned-timeline slot (see AlignedFrameResolver) -- the camera
   * should blank its pane rather than draw anything for that slot.
   */
  seek: (frame: number | undefined) => void;

  centerOn(coords: { x: number; y: number; z: number }): void;
  transition(coords: { x: number; y:number}, duration: number, zoom?: number): void;
  setCursor(cursor: string): void;
  setImageCursor(icon: string, editing?: boolean): void;
  resetMapDimensions(width: number, height: number, isMap?: boolean, margin?: number): void;
}
