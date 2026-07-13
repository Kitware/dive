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
  /**
   * Inverse of resolveSlot (see dive-common/alignedTimeline.ts's
   * buildInverseAlignedIndex): given a camera and its own local frame,
   * returns the global aligned-timeline slot it appears in, or undefined if
   * that local frame isn't part of any slot.
   */
  resolveGlobalSlot: (camera: string, localFrame: number) => number | undefined;
  /**
   * Global slot indices where at least one camera has no frame (see
   * dive-common/alignedTimeline.ts's computeGapSlots) -- used to render a
   * gap indicator on the timeline scrubber.
   */
  gapSlots: Readonly<Ref<number[]>>;
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
  /**
   * True only while onResize is applying its programmatic size()/resetZoom()
   * to the panes. resetZoom emits GeoJS pan/zoom events synchronously; the
   * linked-viewer navigation (useAlignedNavigation / useCalibrationNavigation)
   * must ignore those so one pane's native-space reset isn't broadcast to the
   * others as if it were a shared-space move (which parks warped panes on an
   * empty corner). The resizeTrigger bump that follows re-snaps every pane from
   * the reference once the reset has settled.
   */
  resizing: Readonly<Ref<boolean>>;
  /**
   * Global aligned-timeline slot indices with at least one camera missing a
   * frame (see AlignedFrameResolver's gapSlots); empty whenever alignment
   * isn't active.
   */
  alignedGapSlots: Readonly<Ref<number[]>>;

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
  /**
   * Seeks so that `camera` lands on its own local frame `localFrame` (e.g.
   * jumping to a track's stored begin/end, which is in local-frame units).
   * Under an aligned timeline (see AlignedFrameResolver) this translates
   * through the global slot so every camera stays aligned; otherwise it's
   * equivalent to seek(localFrame), since local and global frame numbers are
   * identical under today's positional broadcast.
   */
  seekCameraFrame: (camera: string, localFrame: number) => void;
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
   * Bumped whenever the annotator redraws its media quad: the async <img>
   * swap after a seek finishes loading, an image-enhancement change (the
   * percentile-stretch URL remap or the CSS filter toggle), or the initial
   * video quad. Watchers that render a snapshot of the displayed element
   * (e.g. the aligned-view warp) rely on this as their
   * only signal that the element changed -- every draw path must bump it.
   */
  imageRevision: Readonly<Ref<number>>;
  /**
   * This pane's native content bounds ({left: 0, top: 0, right: width,
   * bottom: height}, as last applied by resetMapDimensions) -- the rectangle
   * the plain resetZoom fits. The aligned-view reset maps these corners
   * through the camera's native->reference homography to fit the warped
   * content instead (see useAlignedNavigation).
   */
  originalBounds: Readonly<Ref<{
    left: number; top: number; right: number; bottom: number;
  }>>;
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
