/**
 * Interactive Stereo types.
 *
 * The runtime service manager was merged into the unified InteractiveServiceManager
 * (see ./interactive). This module now only holds the stereo request/response
 * contracts shared between that manager and the IPC layer.
 */

/** Error message shown to users when stereo service fails to load */
export const STEREO_LOAD_ERROR_MESSAGE = 'Unable to load stereo service';

/** Calibration data for stereo depth computation */
export interface StereoCalibration {
  fx_left: number;
  fy_left?: number;
  cx_left: number;
  cy_left: number;
  T: [number, number, number];
}

/** Request to set the current stereo frame */
export interface StereoSetFrameRequest {
  leftImagePath: string;
  rightImagePath: string;
  /** Time in seconds when paths are video files */
  frameTime?: number;
}

/** Response from set frame request */
export interface StereoSetFrameResponse {
  id: string;
  success: boolean;
  error?: string;
  disparityReady: boolean;
  message?: string;
}

/** Request to transfer a line from left to right image */
export interface StereoTransferLineRequest {
  line: [[number, number], [number, number]];
}

/**
 * Full stereo measurement for a line, mirroring VIAME's compute_stereo_measurement.
 * All values are in calibration units (e.g. mm). Keys match VIAME's attribute names.
 */
export interface StereoMeasurement {
  length: number;
  midpoint_x: number;
  midpoint_y: number;
  midpoint_z: number;
  midpoint_range: number;
  stereo_rms: number;
}

/** Response from transfer line request */
export interface StereoTransferLineResponse {
  id: string;
  success: boolean;
  error?: string;
  transferredLine?: [[number, number], [number, number]];
  originalLine?: [[number, number], [number, number]];
  /** Triangulated 3D length of the line in calibration units (e.g. mm). */
  length?: number;
  /** Full stereo measurement (length, midpoint, range, RMS). */
  measurement?: StereoMeasurement;
  depthInfo?: {
    depthPoint1: number | null;
    depthPoint2: number | null;
    disparityPoint1: number;
    disparityPoint2: number;
  };
}

/** Request to triangulate the length of a line already corresponded on both images */
export interface StereoMeasureLineRequest {
  leftLine: [[number, number], [number, number]];
  rightLine: [[number, number], [number, number]];
}

/** Response from a measure-line request */
export interface StereoMeasureLineResponse {
  id: string;
  success: boolean;
  error?: string;
  /** Triangulated 3D length in calibration units (e.g. mm). */
  length?: number;
  /** Full stereo measurement (length, midpoint, range, RMS). */
  measurement?: StereoMeasurement;
}

/** Request to aggregate per-detection lengths along a track into a single value */
export interface StereoAggregateLengthsRequest {
  lengths: number[];
  /** 'average' (default), 'average_iqr', or 'median'. */
  method?: string;
}

/** Response from an aggregate-lengths request */
export interface StereoAggregateLengthsResponse {
  id: string;
  success: boolean;
  error?: string;
  /** Aggregated length in calibration units (e.g. mm). */
  avgLength?: number;
}

/** Request to transfer multiple points */
export interface StereoTransferPointsRequest {
  points: [number, number][];
}

/** Response from transfer points request */
export interface StereoTransferPointsResponse {
  id: string;
  success: boolean;
  error?: string;
  transferredPoints?: [number, number][];
  originalPoints?: [number, number][];
  disparityValues?: number[];
}

/** Status response from the stereo service */
export interface StereoStatusResponse {
  id: string;
  success: boolean;
  enabled: boolean;
  disparityReady: boolean;
  computing?: boolean;
  currentLeftPath?: string;
  currentRightPath?: string;
  hasCalibration: boolean;
}
