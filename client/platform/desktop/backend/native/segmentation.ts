/**
 * Interactive Segmentation types.
 *
 * The runtime service manager was merged into the unified InteractiveServiceManager
 * (see ./interactive). This module now only holds the segmentation types shared
 * between that manager and the IPC layer.
 */

import { StereoMeasurement } from './stereo';

/** Error message shown to users when segmentation model process fails to load */
export const SEGMENTATION_LOAD_ERROR_MESSAGE = "Model failed to load. If you haven't downloaded the SAM2 model pack from the VIAME Add-On wiki, please do so.";

/** Request to the segmentation service */
export interface SegmentationInternalPredictRequest {
  /** Unique request ID for correlation */
  id: string;
  /** Path to the image file (or video file if frame is specified) */
  imagePath: string;
  /** Point coordinates as [x, y] pairs */
  points: [number, number][];
  /** Point labels: 1 for foreground, 0 for background */
  pointLabels: number[];
  /** Optional low-res mask from previous prediction for refinement */
  maskInput?: number[][];
  /** Whether to return multiple mask options */
  multimaskOutput?: boolean;
  /** Time in seconds when imagePath is a video file */
  frameTime?: number;
}

/** Response from the segmentation service */
export interface SegmentationInternalPredictResponse {
  /** Request ID for correlation */
  id: string;
  /** Whether the prediction succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Polygon coordinates as [x, y] pairs (largest exterior, for backward compat) */
  polygon?: [number, number][];
  /** Multi-polygon data with holes support */
  polygons?: Array<{ exterior: [number, number][]; holes: [number, number][][] }>;
  /** Bounding box [x_min, y_min, x_max, y_max] */
  bounds?: [number, number, number, number];
  /** Quality score from segmentation model */
  score?: number;
  /** Low-res mask for subsequent refinement */
  lowResMask?: number[][];
  /** Mask dimensions [height, width] */
  maskShape?: [number, number];
}

/**
 * Request for stereo point-segmentation. The segmentation service orchestrates
 * everything: it warps a seed to the other camera (reusing the configured
 * interactive-stereo backend), segments there, and -- when enabled -- derives
 * head/tail lines and the stereo measurement.
 */
export interface SegmentationStereoSegmentRequest {
  /** The already-segmented source-camera polygon (for sampling + measurement). */
  polygon?: [number, number][];
  /** Source-camera click points and labels. */
  points: [number, number][];
  pointLabels: number[];
  /** Source (clicked) and other camera image/video paths. */
  sourceImagePath: string;
  otherImagePath: string;
  /** Calibration file path, read by the embedded stereo warper. */
  calibrationFile?: string;
  /** Time in seconds when the paths are video files. */
  frameTime?: number;
}

/** Response: the other-camera polygon plus optional lines + measurement. */
export interface SegmentationStereoSegmentResponse {
  id: string;
  success: boolean;
  error?: string;
  /** Other-camera polygon from SAM. */
  polygon?: [number, number][];
  bounds?: [number, number, number, number];
  score?: number;
  /** Seed point(s) used on the other camera (median of warped samples). */
  seedPoints?: [number, number][];
  seedLabels?: number[];
  /** Optional head/tail lines: source = clicked camera, other = warped. */
  generateLine?: boolean;
  lineSource?: [[number, number], [number, number]];
  lineOther?: [[number, number], [number, number]];
  measurement?: StereoMeasurement;
}

export type SegmentationPredictRequest = Omit<SegmentationInternalPredictRequest, 'id'>;
export type SegmentationPredictResponse = SegmentationInternalPredictResponse;
