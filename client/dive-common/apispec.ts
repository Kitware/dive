import { provide } from 'vue';
import { AnnotationId, StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import { GroupData } from 'vue-media-annotator/Group';

import { use } from 'vue-media-annotator/provides';
import { TrackData } from 'vue-media-annotator/track';
import { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { CustomStyle } from 'vue-media-annotator/StyleManager';
import { AttributeTrackFilter } from 'vue-media-annotator/AttributeTrackFilterControls';
import { ImageEnhancements } from 'vue-media-annotator/use/useImageEnhancements';
import {
  CameraHomographies, CameraCorrespondences, CameraTransformTypes, RegistrationSource,
} from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import type { PercentileStretch } from 'vue-media-annotator/use/useImageEnhancements';

type DatasetType = 'image-sequence' | 'video' | 'multi' | 'large-image';
type MultiTrackRecord = Record<string, TrackData>;
type MultiGroupRecord = Record<string, GroupData>;
type SubType = 'stereo' | 'multicam' | null; // Additional type info used for UI display enabled pipelines
type PipelineParamType = | 'bool'
  | 'int' | 'positive_int' | 'strictly_positive_int' | 'range_int'
  | 'float' | 'positive_float' | 'strictly_positive_float' | 'range_float'
  | 'folder' | 'path'
  | 'file';

interface AnnotationSchema {
  version: number;
  tracks: MultiTrackRecord;
  groups: MultiGroupRecord;
}

/**
 * Variation on AnnotationSchema where annotations are lists
 * instead of objects, used for convenience with pagination.
 */
interface AnnotationSchemaList {
  version: number;
  tracks: TrackData[];
  groups: GroupData[];
  sets: string[];
}

interface DiveParam {
  label: string;
  type: PipelineParamType;
  type_props?: string[];
  key: string;
  default: string;
}

interface PipeMetadata {
  description?: string;
  inputType?: string;
  outputType?: string;
  diveParams?: DiveParam[];
  requiresCalibration?: boolean;
  /**
   * KWIVER config key (e.g. "stabilizer:flight_log") that the dataset's optional
   * metadata file should be bound to at run time. Parsed from a pipe header
   * `# Metadata File: <block>:<key>`. When unset, the pipe does not consume a
   * metadata file and none is injected.
   */
  metadataFileKey?: string;
  /**
   * KWIVER config keys (e.g. "stabilizer:image_list") that should receive the
   * primary (first-camera / single) input image-list manifest path, parsed from
   * a `# Image List Keys:` header.
   */
  imageListKeys?: string[];
  /**
   * KWIVER config keys (e.g. "stabilizer:frame_list") that should receive the
   * comma-joined per-camera input manifest paths, parsed from a
   * `# Frame List Keys:` header.
   */
  frameListKeys?: string[];
}

interface PipelineRuntimeParams {
  frameRange?: [number, number] | null;
}

interface PipelineParams {
  kwiverParams?: Record<string, string>;
  runtimeParams?: PipelineRuntimeParams;
}

interface Pipe {
  name: string;
  pipe: string;
  type: string;
  metadata?: PipeMetadata;
  folderId?: string;
  ownerId?: string;
  ownerLogin?: string;
}

interface Category {
  description: string;
  pipes: Pipe[];
}

interface TrainingConfig {
  name: string;
  description?: string;
}

interface TrainingConfigs {
  training: {
    configs: TrainingConfig[];
    default: string;
  };
  models: Record<string, {
    name: string;
    type: string;
    path?: string;
    folderId?: string;
  }>;
}

type Pipelines = Record<string, Category>;

interface SaveDetectionsArgs {
  tracks: {
    delete: AnnotationId[];
    upsert: TrackData[];
  };
  groups: {
    delete: AnnotationId[];
    upsert: GroupData[];
  };
  set?: string;
}

interface SaveAttributeArgs {
  delete: string[];
  upsert: Attribute[];
}

interface SaveAttributeTrackFilterArgs {
  delete: string[];
  upsert: AttributeTrackFilter[];
}

interface FrameImage {
  url: string;
  filename: string;
  /** Required for large-image (tiled) datasets; used as itemId for getTiles/getTileURL */
  id?: string;
  /** Best-effort capture timestamp (epoch seconds) parsed from the filename, when available */
  timestamp?: number;
}

export interface MultiCamImportFolderArgs {
  datasetName?: string; // Girder parent folder name (required on web)
  defaultDisplay: string; // In multicam the default camera to display
  /** Display order for cameras (matches sourceList / UI order). */
  cameraOrder?: string[];
  sourceList: Record<string, {
    sourcePath: string;
    trackFile: string;
    /**
     * Optional alignment transform file for cameras after the first (desktop
     * only): a DIVE registration .json, parsed at import time to seed the
     * dataset's saved camera registration.
     */
    transformFile?: string;
    /** Per-camera media type when cameras differ (e.g. EO JPG + IR TIFF on web). */
    type?: 'image-sequence' | 'video' | 'large-image';
    /**
     * Filename glob selecting this camera's images when cameras share one
     * folder (e.g. flat view folders split by *_rgb.* / *_ir.* / *_uv.*).
     */
    glob?: string;
  }>; // path/track file per camera
  calibrationFile?: string; // NPZ calibation matrix file
  metadataFile?: string; // Optional per-dataset metadata file (e.g. sea-lion flight log)
  type: 'image-sequence' | 'video' | 'large-image';
}

export interface MultiCamImportKeywordArgs {
  defaultDisplay: string; // In multicam the default camera to display
  sourcePath: string; // Base folder used for import, globList will filter folder
  globList: Record<string, {
    glob: string;
    trackFile: string;
  }>; // glob pattern for base folder
  calibrationFile?: string; // NPZ calibation matrix file
  metadataFile?: string; // Optional per-dataset metadata file (e.g. sea-lion flight log)
  type: 'image-sequence'; // Always image-sequence type for glob matching
}

export type MultiCamImportArgs = MultiCamImportFolderArgs | MultiCamImportKeywordArgs;

interface MultiCamMedia {
  cameras: Record<string, {
    type: DatasetType;
    imageData: FrameImage[];
    videoUrl: string;
  }>;
  defaultDisplay: string; // Default camera for displaying the MultiCamMedia
  /** Camera names in display order (import / UI order). */
  cameraOrder?: string[];
}

interface MediaImportResponse {
  jsonMeta: {
    originalImageFiles: string[];
  };
  globPattern: string;
  mediaConvertList: string[];
}
/**
 * The parts of metadata a user should be able to modify.
 */
interface DatasetMetaMutable {
  customTypeStyling?: Record<string, CustomStyle>;
  customGroupStyling?: Record<string, CustomStyle>;
  confidenceFilters?: Record<string, number>;
  timeFilters?: [number, number] | null;
  imageEnhancements?: ImageEnhancements;
  attributes?: Readonly<Record<string, Attribute>>;
  attributeTrackFilters?: Readonly<Record<string, AttributeTrackFilter>>;
  datasetInfo?: Record<string, unknown>;
  cameraHomographies?: CameraHomographies;
  cameraCorrespondences?: CameraCorrespondences;
  cameraTransformTypes?: CameraTransformTypes;
  /** Producer provenance of the camera registration (see RegistrationSource). */
  cameraRegistrationSource?: RegistrationSource | null;
  error?: string;
}
const DatasetMetaMutableKeys = ['attributes', 'confidenceFilters', 'timeFilters', 'imageEnhancements', 'customTypeStyling', 'customGroupStyling', 'attributeTrackFilters', 'datasetInfo', 'cameraHomographies', 'cameraCorrespondences', 'cameraTransformTypes', 'cameraRegistrationSource'];

interface DatasetMeta extends DatasetMetaMutable {
  id: Readonly<string>;
  imageData: Readonly<FrameImage[]>;
  videoUrl: Readonly<string | undefined>;
  // Path to original video for native (non-transcoded) playback via frame extraction
  nativeVideoPath?: Readonly<string>;
  type: Readonly<DatasetType | 'multi'>;
  fps: Readonly<number>; // this will become mutable in the future.
  name: Readonly<string>;
  createdAt: Readonly<string>;
  originalFps?: Readonly<number>;
  subType: Readonly<SubType>; // In future this could have stuff like IR/EO
  multiCamMedia: Readonly<MultiCamMedia | null>;
  /** Stereo calibration / camera file currently associated with the dataset (desktop). */
  calibration?: Readonly<string | null>;
  /** Optional metadata file associated with the dataset, passed to opt-in pipelines. */
  metadataFile?: Readonly<string | null>;
}

interface CameraCalibration {
  cx?: number
  cy?: number
  fx?: number
  fy?: number
  k1?: number
  k2?: number
  k3?: number
  p1?: number
  p2?: number
  rmsError?: number
}

interface DatasetStereoCalibration {
  R: number[]
  T: number[]
  gridHeight?: number
  gridWidth?: number
  imageHeight?: number
  imageWidth?: number
  squareSize?: number
  rmsError?: number
  calibrations: Record<string, CameraCalibration>
}

interface DatasetCalibrationResult {
  /** Parsed calibration parameters from the JSON camera-rig file. */
  calibration?: DatasetStereoCalibration
  /** Source calibration item (calibrationFile). Used by pipelines and download. */
  itemId?: string;
  /** JSON camera-rig item (jsonCalibrationFile). Used for display parameters. */
  jsonItemId?: string;
  /** Source calibration filename. */
  originalName?: string;
  /** JSON camera-rig filename. */
  jsonPath?: string;
  /** Alias for jsonPath (legacy). */
  path?: string;
  /** Present when a background conversion job failed for the linked source file. */
  conversionError?: string;
}

interface Api {
  getPipelineList(): Promise<Pipelines>;
  runPipeline(itemId: string, pipeline: Pipe, pipelineParams?: PipelineParams): Promise<unknown>;
  deleteTrainedPipeline(pipeline: Pipe): Promise<void>;
  exportTrainedPipeline(path: string, pipeline: Pipe): Promise<unknown>;
  getDatasetCalibration(datasetId: string): Promise<DatasetCalibrationResult | null>;

  getTrainingConfigurations(): Promise<TrainingConfigs>;
  runTraining(
    folderIds: string[],
    pipelineName: string,
    config: string,
    annotatedFramesOnly: boolean,
    labelText?: string,
    fineTuneModel?: {
      name: string;
      type: string;
      path?: string;
      folderId?: string;
    },
  ): Promise<unknown>;

  loadMetadata(datasetId: string): Promise<DatasetMeta>;
  loadDetections(datasetId: string, revision?: number, set?: string): Promise<AnnotationSchemaList>;

  saveDetections(datasetId: string, args: SaveDetectionsArgs): Promise<unknown>;
  saveMetadata(datasetId: string, metadata: DatasetMetaMutable): Promise<unknown>;
  saveAttributes(datasetId: string, args: SaveAttributeArgs): Promise<unknown>;
  saveAttributeTrackFilters(datasetId: string,
    args: SaveAttributeTrackFilterArgs): Promise<unknown>;
  // Non-Endpoint shared functions
  openFromDisk(datasetType: DatasetType | 'bulk' | 'calibration' | 'annotation' | 'text' | 'zip' | 'transform' | 'metadata', directory?: boolean):
    Promise<{canceled?: boolean; filePaths: string[]; fileList?: File[]; root?: string}>;
  /** Desktop: immediate child directory names under a parent folder (multicam subfolder import). */
  listImmediateSubfolders?(parentPath: string): Promise<string[]>;
  /** Desktop: subfolders or root-level video files under a parent folder (multicam import). */
  listParentFolderCameras?(
    parentPath: string,
    mediaType: 'image-sequence' | 'video',
  ): Promise<{ name: string; sourcePath: string }[]>;
  /** Desktop: folder path for image-sequence, or first video file inside the folder for video. */
  resolveMulticamCameraSourcePath?(
    subfolderPath: string,
    mediaType: 'image-sequence' | 'video',
  ): Promise<string>;
  /** Desktop: stereoscopic calibration file in a parent folder root. */
  findParentFolderCalibrationFile?(parentPath: string): Promise<string | null>;
  /**
   * Desktop: every DIVE camera-calibration .json (alignment transforms) in a
   * parent folder root: per-camera *_registration.json files first, then
   * other self-identified candidates.
   */
  findParentFolderTransformFiles?(parentPath: string): Promise<string[]>;
  /** True when the dataset folder has an attached stereoscopic calibration file. */
  hasCalibrationFile?(datasetId: string): Promise<boolean>;
  /** Web: stash a calibration File for multicam upload lookup. */
  stashCalibrationFile?(key: string, file: File): void;
  /** Web: stash a per-camera registration transform File for multicam upload lookup. */
  stashTransformFile?(key: string, file: File): void;
  getTiles?(itemId: string, projection?: string): Promise<StringKeyObject>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTileURL?(itemId: string, x: number, y: number, level: number, query: Record<string, any>):
   string;
  getTileHistogram?(itemId: string, options?: {
    bins?: number;
    frame?: number;
    width?: number;
    height?: number;
  }): Promise<unknown>;
  importAnnotationFile(id: string, path: string, file?: File,
    additive?: boolean, additivePrepend?: string, set?: string): Promise<boolean | string[]>;
  // Desktop-only calibration persistence functions
  getLastCalibration?(): Promise<string | null>;
  saveCalibration?(path: string): Promise<{ savedPath: string; updatedDatasetIds: string[] }>;
  /** Desktop: set the stereo camera/calibration file for a single dataset. */
  importCalibrationFile?(datasetId: string, path: string): Promise<{ calibration: string }>;
  /**
   * Merge a DIVE registration .json into an existing multicam dataset's
   * saved camera registration. Web reads the provided File; desktop reads
   * the path. options.camera keeps only the file's pairs naming that
   * camera, replacing that camera's current pairs while other cameras'
   * pairs are kept.
   */
  importCameraRegistration?(datasetId: string, path: string, file?: File,
    options?: { camera?: string }):
    Promise<{ cameras: string[]; pairCount: number }>;
  /** Desktop: copy the dataset's current camera/calibration file out to destPath. */
  exportCalibrationFile?(datasetId: string, destPath: string): Promise<{ exportedPath: string }>;
  /** Download/export the dataset's current calibration file (platform-specific). */
  downloadCalibration?(datasetId: string): Promise<void>;
  /** Remove the calibration file currently associated with the dataset. */
  deleteCalibration?(datasetId: string): Promise<void>;
}
const ApiSymbol = Symbol('api');

/**
 * provideApi specifies an implementation of the data persistence interface
 * for use in vue-web-common
 * @param api an api implementation
 */
function provideApi(api: Api) {
  provide(ApiSymbol, api);
}

function useApi() {
  return use<Readonly<Api>>(ApiSymbol);
}

/**
 * Interactive Segmentation Types
 */
export interface SegmentationPredictRequest {
  /** Path to the image file */
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

export interface SegmentationPredictResponse {
  /** Whether the prediction succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Polygon coordinates as [x, y] pairs */
  polygon?: [number, number][];
  /** Bounding box [x_min, y_min, x_max, y_max] */
  bounds?: [number, number, number, number];
  /** Quality score from segmentation model */
  score?: number;
  /** Low-res mask for subsequent refinement */
  lowResMask?: number[][];
  /** Mask dimensions [height, width] */
  maskShape?: [number, number];
  /** RLE-encoded full-resolution mask for display: [[value, count], ...] */
  rleMask?: [number, number][];
}

/**
 * Stereo point-segmentation. The segmentation service warps the seed to the
 * other camera (configured stereo backend), segments there, and -- when enabled
 * -- derives head/tail lines + the measurement.
 */
export interface SegmentationStereoSegmentRequest {
  /** The already-segmented source-camera polygon (sampling + measurement). */
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
  /** Stereo measurement for the derived line (calibration units, e.g. mm). */
  measurement?: {
    length: number;
    midpoint_x: number;
    midpoint_y: number;
    midpoint_z: number;
    midpoint_range: number;
    stereo_rms: number;
  };
}

export interface SegmentationStatusResponse {
  /** Whether segmentation is available */
  available: boolean;
  /** Whether the model is currently loaded */
  loaded?: boolean;
  /** Whether the service is ready for predictions */
  ready?: boolean;
}

/**
 * Text Query Types for open-vocabulary detection/segmentation
 */

/** A single detection returned from a text query */
export interface TextQueryDetection {
  /** Bounding box [x1, y1, x2, y2] */
  box: [number, number, number, number];
  /** Polygon coordinates as [x, y] pairs */
  polygon?: [number, number][];
  /** Confidence score */
  score: number;
  /** Label/class name (often the query text) */
  label: string;
  /** Low-res mask for refinement (optional) */
  lowResMask?: number[][];
}

export interface TextQueryRequest {
  /** Path to the image file (or video file for video datasets) */
  imagePath: string;
  /** Frame time in seconds, required when imagePath is a video so the service
   * extracts the correct frame. Omitted for image-sequence datasets. */
  frameTime?: number;
  /** Text query describing what to find (e.g., "fish", "person swimming") */
  text: string;
  /** Confidence threshold for detections (default: 0.3) */
  boxThreshold?: number;
  /** Maximum number of detections to return (default: 10) */
  maxDetections?: number;
  /** Optional boxes to refine [x1, y1, x2, y2][] */
  boxes?: [number, number, number, number][];
  /** Optional keypoints for refinement [x, y][] */
  points?: [number, number][];
  /** Labels for points: 1 for foreground, 0 for background */
  pointLabels?: number[];
  /** Optional masks to refine */
  masks?: number[][][];
}

export interface TextQueryResponse {
  /** Whether the query succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** List of detections found */
  detections?: TextQueryDetection[];
  /** The original query text */
  query?: string;
  /** Whether fallback method was used (no native text support) */
  fallback?: boolean;
}

export interface RefineDetectionsRequest {
  /** Path to the image file */
  imagePath: string;
  /** Detections to refine */
  detections: TextQueryDetection[];
  /** Optional additional keypoints for refinement [x, y][] */
  points?: [number, number][];
  /** Labels for additional points: 1 for foreground, 0 for background */
  pointLabels?: number[];
  /** Whether to include refined masks in response */
  refineMasks?: boolean;
}

export interface RefineDetectionsResponse {
  /** Whether the refinement succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Refined detections */
  detections?: TextQueryDetection[];
}

export {
  provideApi,
  useApi,
};

export {
  AnnotationSchema,
  Api,
  DatasetMeta,
  DatasetMetaMutable,
  DatasetMetaMutableKeys,
  DatasetType,
  DiveParam,
  CameraCalibration,
  DatasetStereoCalibration,
  DatasetCalibrationResult,
  SubType,
  PipelineParamType,
  FrameImage,
  MultiTrackRecord,
  MultiGroupRecord,
  Pipe,
  PipelineParams,
  PipelineRuntimeParams,
  PipeMetadata,
  Pipelines,
  SaveDetectionsArgs,
  SaveAttributeArgs,
  SaveAttributeTrackFilterArgs,
  TrainingConfig,
  TrainingConfigs,
  MultiCamMedia,
  MediaImportResponse,
};

export type { PercentileStretch };
