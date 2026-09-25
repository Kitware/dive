/**
 * Server-side interactive segmentation and stereo: the GPU host runs VIAME's
 * interactive service and girder resolves dataset frames to its inputs.
 */
import type {
  SegmentationPolygon, SegmentationPolygonKeypointsResponse, SegmentationPredictResponse,
  SegmentationStereoSegmentResponse, TextQueryResponse,
} from 'dive-common/apispec';
import type { StereoMatchMethod } from 'dive-common/use/stereo/stereoMatcher';
import girderRest from 'platform/web-girder/plugins/girder';

export interface InteractiveStatus {
  interactiveEnabled: boolean;
  interactiveMessage: string;
  interactiveStereoMethods?: StereoMatchMethod[];
  interactiveTextQuery?: boolean;
}

interface FrameRequest {
  datasetId: string;
  /** Camera name of a multi-camera dataset; ignored for single-camera ones. */
  camera?: string;
  frame: number;
}

export interface InteractivePredictRequest extends FrameRequest {
  points: [number, number][];
  pointLabels: number[];
  box?: [number, number, number, number];
  line?: [number, number][];
  multimaskOutput?: boolean;
}

export interface InteractiveStereoSegmentRequest {
  datasetId: string;
  frame: number;
  sourceCamera: string;
  points: [number, number][];
  pointLabels: number[];
  polygon?: [number, number][];
  polygons?: SegmentationPolygon[];
  method?: StereoMatchMethod;
}

export interface InteractiveTransferPointsRequest {
  datasetId: string;
  frame: number;
  sourceCamera: string;
  points: [number, number][];
  strict?: boolean;
  method?: StereoMatchMethod;
}

export interface InteractiveTransferPointsResponse {
  success: boolean;
  error?: string;
  transferredPoints?: [number, number][];
  validMatches?: boolean[];
  disparityValues?: number[];
}

export interface InteractiveMeasurement {
  length: number;
  midpoint_x: number;
  midpoint_y: number;
  midpoint_z: number;
  midpoint_range: number;
  stereo_rms: number;
}

export interface InteractiveTransferLineResponse {
  success: boolean;
  error?: string;
  transferredLine?: [number, number][];
  length?: number;
  measurement?: InteractiveMeasurement;
}

const BASE = 'dive_interactive';

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return (await girderRest.post<T>(`${BASE}/${path}`, body)).data;
}

export async function getInteractiveStatus(): Promise<InteractiveStatus> {
  return (await girderRest.get<InteractiveStatus>(`${BASE}/status`)).data;
}

export function interactiveSegmentationPredict(
  request: InteractivePredictRequest,
): Promise<SegmentationPredictResponse> {
  return post<SegmentationPredictResponse>('segmentation/predict', { ...request });
}

export function interactiveSegmentationKeypoints(datasetId: string, polygon: [number, number][], polygons?: SegmentationPolygon[]): Promise<SegmentationPolygonKeypointsResponse> {
  return post<SegmentationPolygonKeypointsResponse>('segmentation/keypoints', { datasetId, polygon, polygons });
}

export async function interactiveStereoSegment(
  request: InteractiveStereoSegmentRequest,
): Promise<SegmentationStereoSegmentResponse> {
  const raw = await post<Record<string, unknown>>('segmentation/stereo_segment', { ...request });
  return {
    id: '',
    success: !!raw.success,
    error: raw.error as string | undefined,
    polygon: raw.polygon as SegmentationStereoSegmentResponse['polygon'],
    polygons: raw.polygons as SegmentationPolygon[] | undefined,
    bounds: raw.bounds as SegmentationStereoSegmentResponse['bounds'],
    score: raw.score as number | undefined,
    seedPoints: raw.seed_points as [number, number][] | undefined,
    seedLabels: raw.seed_labels as number[] | undefined,
    generateLine: raw.generate_line as boolean | undefined,
    lineSource: raw.line_source as SegmentationStereoSegmentResponse['lineSource'],
    lineOther: raw.line_other as SegmentationStereoSegmentResponse['lineOther'],
    measurement: raw.measurement as InteractiveMeasurement | undefined,
  };
}

export function interactiveTextQuery(
  request: FrameRequest & { text: string },
): Promise<TextQueryResponse> {
  return post<TextQueryResponse>('text_query', { ...request });
}

export function interactiveStereoSetFrame(datasetId: string, frame: number, method?: StereoMatchMethod): Promise<{ success: boolean; error?: string; disparity_ready?: boolean }> {
  return post('stereo/set_frame', { datasetId, frame, method });
}

export async function interactiveStereoTransferPoints(
  request: InteractiveTransferPointsRequest,
): Promise<InteractiveTransferPointsResponse> {
  const raw = await post<Record<string, unknown>>('stereo/transfer_points', { ...request });
  return {
    success: !!raw.success,
    error: raw.error as string | undefined,
    transferredPoints: raw.transferred_points as [number, number][] | undefined,
    validMatches: raw.valid_matches as boolean[] | undefined,
    disparityValues: raw.disparity_values as number[] | undefined,
  };
}

export async function interactiveStereoTransferLine(datasetId: string, frame: number, line: [number, number][], method?: StereoMatchMethod): Promise<InteractiveTransferLineResponse> {
  const raw = await post<Record<string, unknown>>('stereo/transfer_line', {
    datasetId, frame, line, method,
  });
  return {
    success: !!raw.success,
    error: raw.error as string | undefined,
    transferredLine: raw.transferred_line as [number, number][] | undefined,
    length: raw.length as number | undefined,
    measurement: raw.measurement as InteractiveMeasurement | undefined,
  };
}

export function interactiveStereoMeasureLine(
  datasetId: string,
  frame: number,
  leftLine: [number, number][],
  rightLine: [number, number][],
  method?: StereoMatchMethod,
): Promise<{ success: boolean; error?: string; length?: number; measurement?: InteractiveMeasurement }> {
  return post('stereo/measure_line', {
    datasetId, frame, leftLine, rightLine, method,
  });
}

export function interactiveStereoAggregateLengths(datasetId: string, lengths: number[], method?: string): Promise<{ success: boolean; error?: string; avg_length?: number }> {
  return post('stereo/aggregate_lengths', { datasetId, lengths, method });
}

export async function endInteractiveSession(datasetId: string): Promise<void> {
  await girderRest.delete(`${BASE}/session`, { params: { datasetId } });
}
