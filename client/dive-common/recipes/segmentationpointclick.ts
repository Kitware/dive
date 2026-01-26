/**
 * Segmentation Point-Click Recipe
 *
 * Allows users to click on objects to automatically generate segmentation
 * masks using point-based segmentation models.
 *
 * Usage:
 * - Activate with 's' hotkey or Segment button
 * - Left-click: Add foreground point (include in segmentation)
 * - Shift+click or Middle-click: Add background point (exclude from segmentation)
 * - Right-click: Confirm and lock the annotation
 * - Enter: Confirm and commit the segmentation
 * - Escape: Cancel and clear points
 *
 * Multi-frame support:
 * - Points are tracked per-frame
 * - When switching frames, previous frame's points are saved
 * - Visual dots only show for the current frame
 * - Confirming commits all frames with valid polygons
 *
 * Error handling:
 * - If first point fails, segmentation is deactivated
 * - If subsequent points fail, the point is rejected with message
 *   "Latest point rejected by segmentation method"
 */

import Vue, { ref, Ref } from 'vue';

import Track from 'vue-media-annotator/track';
import Recipe, { UpdateResponse } from 'vue-media-annotator/recipe';
import { EditAnnotationTypes } from 'vue-media-annotator/layers';
import { Mousetrap } from 'vue-media-annotator/types';
import { SegmentationPredictRequest, SegmentationPredictResponse } from 'dive-common/apispec';

export const SegmentationPolygonKey = 'SegmentationPolygon';

const EmptyResponse: UpdateResponse = {
  data: {},
  union: [],
  unionWithoutBounds: [],
};

export interface SegmentationRecipeOptions {
  /**
   * Function to call segmentation predict API (platform-specific)
   * @param request - The prediction request with points and labels
   * @param frameNum - The current frame number (useful for web platform)
   */
  predictFn: (request: SegmentationPredictRequest, frameNum: number) => Promise<SegmentationPredictResponse>;
  /** Function to get image path for current frame (used by desktop platform) */
  getImagePath: (frameNum: number) => string;
  /**
   * Optional function to initialize the segmentation service.
   * Called when the recipe is activated (user clicks Segment button).
   * Should throw an error if initialization fails.
   */
  initializeServiceFn?: () => Promise<void>;
}

/** Callback data when prediction completes */
export interface SegmentationPredictionResult {
  polygon: [number, number][];
  bounds: [number, number, number, number] | null;
  frameNum: number;
  /** RLE-encoded full-resolution mask for display */
  rleMask?: [number, number][];
  /** Mask dimensions [height, width] */
  maskShape?: [number, number];
}

/** Data stored per frame for multi-frame segmentation */
interface FrameSegmentationData {
  points: [number, number][];
  labels: number[];
  polygon: [number, number][] | null;
  bounds: [number, number, number, number] | null;
  lowResMask: number[][] | null;
  rleMask: [number, number][] | null;
  maskShape: [number, number] | null;
}

/** Result containing all frames for multi-frame confirmation */
export interface MultiFrameSegmentationResult {
  /** Map of frame number to segmentation result */
  frames: Map<number, SegmentationPredictionResult>;
}

/**
 * Segmentation Point-Click Recipe
 *
 * This recipe captures point clicks and uses segmentation models to generate polygons.
 */
export default class SegmentationPointClick implements Recipe {
  active: Ref<boolean>;

  name: string;

  bus: Vue;

  toggleable: Ref<boolean>;

  icon: Ref<string>;

  /** Platform-specific segmentation predict function */
  private predictFn: ((request: SegmentationPredictRequest, frameNum: number) => Promise<SegmentationPredictResponse>) | null = null;

  /** Function to get image path for current frame */
  private getImagePath: ((frameNum: number) => string) | null = null;

  /** Function to initialize the segmentation service (called on activation) */
  private initializeServiceFn: (() => Promise<void>) | null = null;

  /** Whether the service has been successfully initialized */
  private serviceInitialized: boolean = false;

  /** Whether activation is pending (waiting for async init to complete) */
  private pendingActivation: boolean = false;

  /** Accumulated points for current frame's segmentation */
  private points: [number, number][] = [];

  /** Labels for accumulated points (1=foreground, 0=background) */
  private pointLabels: number[] = [];

  /** Low-res mask from last prediction (for refinement) */
  private lastLowResMask: number[][] | null = null;

  /** Pending polygon from async prediction */
  private pendingPolygon: [number, number][] | null = null;

  /** Pending bounds from async prediction */
  private pendingBounds: [number, number, number, number] | null = null;

  /** Pending RLE mask from async prediction (for display) */
  private pendingRleMask: [number, number][] | null = null;

  /** Pending mask shape from async prediction */
  private pendingMaskShape: [number, number] | null = null;

  /** Whether a prediction is currently in progress */
  private isPredicting: boolean = false;

  /** Current frame number */
  private currentFrame: number = 0;

  /** Per-frame segmentation data for multi-frame support */
  private frameData: Map<number, FrameSegmentationData> = new Map();

  /** Whether the recipe is currently loading (initializing the service) */
  loading: Ref<boolean>;

  constructor() {
    this.bus = new Vue();
    this.active = ref(false);
    this.name = 'Segment';
    this.toggleable = ref(true);
    this.icon = ref('mdi-auto-fix');
    this.loading = ref(false);
  }

  /**
   * Initialize the recipe with platform-specific options.
   * Must be called before using the recipe.
   */
  initialize(options: SegmentationRecipeOptions): void {
    this.predictFn = options.predictFn;
    this.getImagePath = options.getImagePath;
    this.initializeServiceFn = options.initializeServiceFn || null;
    // Reset service initialization state when re-initializing
    this.serviceInitialized = false;
  }

  /**
   * Reset the recipe state (clear accumulated points for all frames)
   */
  private reset(): void {
    this.points = [];
    this.pointLabels = [];
    this.lastLowResMask = null;
    this.pendingPolygon = null;
    this.pendingBounds = null;
    this.pendingRleMask = null;
    this.pendingMaskShape = null;
    this.isPredicting = false;
    this.frameData.clear();
    // Clear visual feedback for points
    this.bus.$emit('points-updated', { points: [], labels: [], frameNum: this.currentFrame });
  }

  /**
   * Reset only the current frame's points (used when clearing current frame)
   */
  private resetCurrentFrame(): void {
    this.points = [];
    this.pointLabels = [];
    this.lastLowResMask = null;
    this.pendingPolygon = null;
    this.pendingBounds = null;
    this.pendingRleMask = null;
    this.pendingMaskShape = null;
    this.frameData.delete(this.currentFrame);
    // Clear visual feedback for points
    this.bus.$emit('points-updated', { points: [], labels: [], frameNum: this.currentFrame });
  }

  /**
   * Save current frame's data to frameData map
   */
  private saveCurrentFrameData(): void {
    if (this.points.length > 0 || this.pendingPolygon || this.pendingRleMask) {
      this.frameData.set(this.currentFrame, {
        points: [...this.points],
        labels: [...this.pointLabels],
        polygon: this.pendingPolygon ? [...this.pendingPolygon] : null,
        bounds: this.pendingBounds ? [...this.pendingBounds] as [number, number, number, number] : null,
        lowResMask: this.lastLowResMask,
        rleMask: this.pendingRleMask ? [...this.pendingRleMask] : null,
        maskShape: this.pendingMaskShape ? [...this.pendingMaskShape] as [number, number] : null,
      });
    }
  }

  /**
   * Load frame data from frameData map into current state
   */
  private loadFrameData(frameNum: number): void {
    const data = this.frameData.get(frameNum);
    if (data) {
      this.points = [...data.points];
      this.pointLabels = [...data.labels];
      this.pendingPolygon = data.polygon ? [...data.polygon] : null;
      this.pendingBounds = data.bounds ? [...data.bounds] as [number, number, number, number] : null;
      this.lastLowResMask = data.lowResMask;
      this.pendingRleMask = data.rleMask ? [...data.rleMask] : null;
      this.pendingMaskShape = data.maskShape ? [...data.maskShape] as [number, number] : null;
    } else {
      this.points = [];
      this.pointLabels = [];
      this.pendingPolygon = null;
      this.pendingBounds = null;
      this.lastLowResMask = null;
      this.pendingRleMask = null;
      this.pendingMaskShape = null;
    }
  }

  /**
   * Handle frame change - save current frame's data and load new frame's data
   * Emits event to clear visual dots when moving to a different frame
   */
  handleFrameChange(newFrame: number): void {
    if (!this.active.value) return;
    if (newFrame === this.currentFrame) return;

    // Save current frame's data
    this.saveCurrentFrameData();

    // Update current frame
    this.currentFrame = newFrame;

    // Load new frame's data (if any)
    this.loadFrameData(newFrame);

    // Update visual feedback for the new frame
    // If new frame has no points, this clears the display
    this.bus.$emit('points-updated', {
      points: [...this.points],
      labels: [...this.pointLabels],
      frameNum: newFrame,
    });

    // If new frame has a pending prediction (polygon or mask), emit it
    if (this.pendingPolygon || this.pendingRleMask) {
      this.bus.$emit('prediction-ready', {
        polygon: this.pendingPolygon || [],
        bounds: this.pendingBounds,
        frameNum: newFrame,
        rleMask: this.pendingRleMask || undefined,
        maskShape: this.pendingMaskShape || undefined,
      } as SegmentationPredictionResult);
    }
  }

  /**
   * Make segmentation prediction with current points
   * @param frameNum - The frame number to predict on
   * @param isFirstPoint - Whether this is the first point (affects error handling)
   */
  private async makePrediction(frameNum: number, isFirstPoint: boolean = false): Promise<void> {
    if (!this.predictFn || !this.getImagePath) {
      return;
    }

    if (this.points.length === 0) {
      return;
    }

    this.isPredicting = true;

    try {
      const imagePath = this.getImagePath(frameNum);

      if (!imagePath) {
        throw new Error(`No image path available for frame ${frameNum}`);
      }

      const request: SegmentationPredictRequest = {
        imagePath,
        points: this.points,
        pointLabels: this.pointLabels,
        maskInput: this.lastLowResMask ?? undefined,
        multimaskOutput: this.points.length === 1, // Use multimask for single point
      };

      const response = await this.predictFn(request, frameNum);

      if (response.success && response.polygon && response.polygon.length > 0) {
        this.pendingPolygon = response.polygon;
        this.pendingBounds = response.bounds ?? null;
        this.lastLowResMask = response.lowResMask ?? null;
        this.pendingRleMask = response.rleMask ?? null;
        this.pendingMaskShape = response.maskShape ?? null;

        // Emit event to notify that prediction is ready
        // Include frameNum so listeners can update the correct frame
        // Includes mask data for display during editing
        this.bus.$emit('prediction-ready', {
          polygon: response.polygon,
          bounds: response.bounds,
          score: response.score,
          frameNum,
          rleMask: response.rleMask,
          maskShape: response.maskShape,
        } as SegmentationPredictionResult & { score?: number });
      } else {
        // Prediction returned an error - handle point rejection
        this.handlePredictionError(response.error || 'Prediction failed', isFirstPoint, frameNum);
      }
    } catch (error) {
      // Exception during prediction - handle point rejection
      const errorMessage = error instanceof Error ? error.message : 'Prediction failed';
      this.handlePredictionError(errorMessage, isFirstPoint, frameNum);
    } finally {
      this.isPredicting = false;
    }
  }

  /**
   * Handle prediction errors - remove rejected point and stay in edit mode.
   * The user can manually reset or cancel if they want to start over.
   */
  private handlePredictionError(originalError: string, isFirstPoint: boolean, frameNum: number): void {
    // Remove the rejected point regardless of whether it was the first point
    this.points.pop();
    this.pointLabels.pop();

    // Update icon to reflect new point count
    this.icon.value = this.points.length > 0
      ? `mdi-numeric-${Math.min(this.points.length, 9)}-circle`
      : 'mdi-auto-fix';

    // Emit updated points to remove the rejected point from visual display
    this.bus.$emit('points-updated', {
      points: [...this.points],
      labels: [...this.pointLabels],
      frameNum,
    });

    // Show error message - different message for first point vs subsequent
    if (isFirstPoint) {
      this.bus.$emit('prediction-error', originalError);
    } else {
      this.bus.$emit('prediction-error', 'Latest point rejected by segmentation method');
    }
    // Stay in edit mode - let the user decide to reset or try again
  }

  /**
   * Recipe update handler - called when user draws/clicks
   */
  update(
    mode: 'in-progress' | 'editing',
    frameNum: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    track: Track,
    data: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    key?: string,
  ): Readonly<UpdateResponse> {
    // Only process if this recipe is active
    if (!this.active.value) {
      return EmptyResponse;
    }

    this.currentFrame = frameNum;

    // Look for point features in the data
    const pointFeatures = data.filter(
      (d) => d.geometry.type === 'Point',
    ) as GeoJSON.Feature<GeoJSON.Point>[];

    // Handle Point clicks - Point mode emits 'editing' directly (not 'in-progress')
    // because points complete immediately. We need to handle both modes.
    if (pointFeatures.length > 0) {
      const point = pointFeatures[0];
      const coords = point.geometry.coordinates as [number, number];

      // Check if this is the same point we already processed (avoid duplicates)
      const lastPoint = this.points[this.points.length - 1];
      const isDuplicate = lastPoint
        && lastPoint[0] === coords[0]
        && lastPoint[1] === coords[1];

      if (!isDuplicate) {
        // Track if this is the first point (for error handling)
        const isFirstPoint = this.points.length === 0;

        // Determine if this is a foreground or background point
        // Check for shift key or middle-click via properties (if available)
        const isBackground = point.properties?.background === true;
        const label = isBackground ? 0 : 1;

        // Add point to accumulator
        this.points.push(coords);
        this.pointLabels.push(label);

        // Update icon to show point count
        this.icon.value = this.points.length > 1
          ? `mdi-numeric-${Math.min(this.points.length, 9)}-circle`
          : 'mdi-auto-fix';

        // Emit point update for visual feedback (green=foreground, red=background)
        this.bus.$emit('points-updated', {
          points: [...this.points],
          labels: [...this.pointLabels],
          frameNum,
        });

        // Trigger segmentation prediction asynchronously
        // The prediction result will be handled by the event listener in Viewer
        // Pass isFirstPoint so error handling knows whether to reject the point
        this.makePrediction(frameNum, isFirstPoint);
      }

      // For Point mode, we DON'T return polygon data here.
      // The polygon will be set directly on the track when prediction completes
      // via the 'prediction-ready' event handler in Viewer.vue.
      // Return done: false to keep the track in edit mode.
      return {
        data: {},
        union: [],
        unionWithoutBounds: [],
        done: false,
      };
    }

    // If we're in editing mode with non-point data and have a pending polygon, commit it
    if (mode === 'editing' && this.pendingPolygon && this.pendingPolygon.length > 2) {
      const polygon: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [this.pendingPolygon],
        },
        properties: {},
      };

      const unionPolygon = this.pendingBounds
        ? SegmentationPointClick.boundsToPolygon(this.pendingBounds)
        : null;

      // Clear state after committing
      this.reset();
      this.deactivate();

      return {
        data: {
          [SegmentationPolygonKey]: [polygon],
        },
        union: unionPolygon ? [unionPolygon] : [],
        unionWithoutBounds: [],
        newSelectedKey: SegmentationPolygonKey,
        done: true,
      };
    }

    return EmptyResponse;
  }

  /**
   * Convert bounds to a GeoJSON Polygon for union calculation
   */
  private static boundsToPolygon(bounds: [number, number, number, number]): GeoJSON.Polygon {
    const [minX, minY, maxX, maxY] = bounds;
    return {
      type: 'Polygon',
      coordinates: [[
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ]],
    };
  }

  /**
   * Handle deletion of segmentation geometry
   */
  delete(frame: number, track: Track, key: string, type: EditAnnotationTypes): void {
    if (key === SegmentationPolygonKey && type === 'Polygon') {
      track.removeFeatureGeometry(frame, { type: 'Polygon', key: SegmentationPolygonKey });
      this.reset();
    }
  }

  /**
   * Handle point deletion (not applicable for segmentation, but required by interface)
   */
  deletePoint(
    frame: number,
    track: Track,
    idx: number,
    key: string,
    type: EditAnnotationTypes,
  ): void {
    // Segmentation doesn't support individual point deletion within a polygon
    // If needed, delete the whole polygon
    if (key === SegmentationPolygonKey && type === 'Polygon') {
      this.delete(frame, track, key, type);
    }
  }

  /**
   * Activate the segmentation recipe.
   * If an initializeServiceFn was provided, it will be called first to ensure
   * the segmentation service is ready. If initialization fails, the recipe will not
   * activate and an error event will be emitted.
   */
  activate(): void {
    // If we have an initialization function and haven't initialized yet, do it now
    if (this.initializeServiceFn && !this.serviceInitialized) {
      // Show loading state
      this.loading.value = true;
      this.icon.value = 'mdi-loading';
      // Track that we're waiting for initialization
      this.pendingActivation = true;

      this.initializeServiceFn()
        .then(() => {
          this.serviceInitialized = true;
          this.loading.value = false;
          // Only complete activation if we weren't deactivated during async wait
          // (e.g., user switched to polygon mode while waiting)
          if (this.pendingActivation) {
            this.pendingActivation = false;
            this.completeActivation();
          }
        })
        .catch((error) => {
          this.pendingActivation = false;
          const errorMessage = error instanceof Error ? error.message : 'Unable to load segmentation module';
          this.bus.$emit('prediction-error', errorMessage);
          this.loading.value = false;
          this.icon.value = 'mdi-auto-fix';
          // Don't activate - stay in previous mode
        });
    } else {
      // No initialization function or already initialized - activate immediately
      this.completeActivation();
    }
  }

  /**
   * Complete the activation after service is ready
   */
  private completeActivation(): void {
    this.active.value = true;
    this.reset();
    this.icon.value = 'mdi-auto-fix';

    // Emit activation event to trigger Point editing mode
    this.bus.$emit('activate', {
      editing: 'Point' as EditAnnotationTypes,
      key: SegmentationPolygonKey,
      recipeName: this.name,
    });
  }

  /**
   * Deactivate the segmentation recipe
   */
  deactivate(): void {
    this.active.value = false;
    // Cancel any pending activation from async init
    this.pendingActivation = false;
    this.loading.value = false;
    this.reset();
    this.icon.value = 'mdi-auto-fix';

    // Emit empty points to clear the visual points layer
    this.bus.$emit('points-updated', {
      points: [],
      labels: [],
      frameNum: this.currentFrame,
    });
  }

  /**
   * Check if there's a pending prediction that can be confirmed (current frame or any saved frame)
   */
  hasPendingPrediction(): boolean {
    // Check current frame
    if (this.pendingPolygon !== null && this.pendingPolygon.length > 2) {
      return true;
    }
    // Check saved frames
    return Array.from(this.frameData.values()).some(
      (data) => data.polygon && data.polygon.length > 2,
    );
  }

  /**
   * Check if there are any points accumulated (current frame or any saved frame)
   */
  hasPoints(): boolean {
    // Check current frame
    if (this.points.length > 0) {
      return true;
    }
    // Check saved frames
    return Array.from(this.frameData.values()).some(
      (data) => data.points.length > 0,
    );
  }

  /**
   * Get the number of frames with pending predictions
   */
  getFrameCount(): number {
    // Save current frame data first
    this.saveCurrentFrameData();

    return Array.from(this.frameData.values()).filter(
      (data) => data.polygon && data.polygon.length > 2,
    ).length;
  }

  /**
   * Public method to reset (clear) all accumulated points and pending prediction.
   * Called from UI Reset button. Clears all frames.
   */
  resetPoints(): void {
    // Emit reset event for all frames with data
    const framesToReset = [this.currentFrame, ...this.frameData.keys()];
    framesToReset.forEach((frameNum) => {
      this.bus.$emit('prediction-reset', { frameNum });
    });
    this.reset();
    this.icon.value = 'mdi-auto-fix';
  }

  /**
   * Public method to confirm the current prediction and emit it for track update.
   * Called from UI Confirm button. Confirms all frames with valid polygons.
   */
  confirmPrediction(): void {
    // Save current frame data to frameData map
    this.saveCurrentFrameData();

    // Collect all frames with valid polygons
    const confirmedFrames: Map<number, SegmentationPredictionResult> = new Map();

    Array.from(this.frameData.entries()).forEach(([frameNum, data]) => {
      if (data.polygon && data.polygon.length > 2) {
        confirmedFrames.set(frameNum, {
          polygon: data.polygon,
          bounds: data.bounds,
          frameNum,
        });
      }
    });

    if (confirmedFrames.size === 0) {
      return;
    }

    // Emit multi-frame confirmed event
    this.bus.$emit('prediction-confirmed-multi', {
      frames: confirmedFrames,
    } as MultiFrameSegmentationResult);

    // Also emit single-frame events for backward compatibility
    // (in case only single-frame handler is registered)
    Array.from(confirmedFrames.values()).forEach((result) => {
      this.bus.$emit('prediction-confirmed', result);
    });

    // Reset state and deactivate
    this.reset();
    this.deactivate();
  }

  /**
   * Implements the Recipe interface's confirm method.
   * Called when right-click is used to lock the annotation.
   */
  confirm(): void {
    if (this.active.value && this.hasPendingPrediction()) {
      this.confirmPrediction();
    }
  }

  /**
   * Keyboard shortcuts for segmentation recipe
   */
  mousetrap(): Mousetrap[] {
    return [
      {
        bind: 's',
        handler: () => {
          if (!this.active.value) {
            this.activate();
          }
        },
      },
      {
        bind: 'escape',
        handler: () => {
          if (this.active.value) {
            this.resetPoints();
          }
        },
      },
      {
        bind: 'enter',
        handler: () => {
          if (this.active.value && this.hasPendingPrediction()) {
            this.confirmPrediction();
          }
        },
      },
    ];
  }
}
