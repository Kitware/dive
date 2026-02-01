import { provide } from 'vue';
import { AnnotationId, StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import { GroupData } from 'vue-media-annotator/Group';

import { use } from 'vue-media-annotator/provides';
import { TrackData } from 'vue-media-annotator/track';
import { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { CustomStyle } from 'vue-media-annotator/StyleManager';
import { AttributeTrackFilter } from 'vue-media-annotator/AttributeTrackFilterControls';
import { ImageEnhancements } from 'vue-media-annotator/use/useImageEnhancements';

type DatasetType = 'image-sequence' | 'video' | 'multi' | 'large-image';
type MultiTrackRecord = Record<string, TrackData>;
type MultiGroupRecord = Record<string, GroupData>;
type SubType = 'stereo' | 'multicam' | null; // Additional type info used for UI display enabled pipelines

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

interface Pipe {
  name: string;
  pipe: string;
  type: string;
  folderId?: string;
  ownerId?: string;
  ownerLogin?: string;
}

interface Category {
  description: string;
  pipes: Pipe[];
}

interface TrainingConfigs {
  training: {
    configs: string[];
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
}

export interface MultiCamImportFolderArgs {
  defaultDisplay: string; // In multicam the default camera to display
  sourceList: Record<string, {
    sourcePath: string;
    trackFile: string;
  }>; // path/track file per camera
  calibrationFile?: string; // NPZ calibation matrix file
  type: 'image-sequence' | 'video';
}

export interface MultiCamImportKeywordArgs {
  defaultDisplay: string; // In multicam the default camera to display
  sourcePath: string; // Base folder used for import, globList will filter folder
  globList: Record<string, {
    glob: string;
    trackFile: string;
  }>; // glob pattern for base folder
  calibrationFile?: string; // NPZ calibation matrix file
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
  imageEnhancements?: ImageEnhancements;
  attributes?: Readonly<Record<string, Attribute>>;
  attributeTrackFilters?: Readonly<Record<string, AttributeTrackFilter>>;
  error?: string;
}
const DatasetMetaMutableKeys = ['attributes', 'confidenceFilters', 'imageEnhancements', 'customTypeStyling', 'customGroupStyling', 'attributeTrackFilters'];

interface DatasetMeta extends DatasetMetaMutable {
  id: Readonly<string>;
  imageData: Readonly<FrameImage[]>;
  videoUrl: Readonly<string | undefined>;
  type: Readonly<DatasetType | 'multi'>;
  fps: Readonly<number>; // this will become mutable in the future.
  name: Readonly<string>;
  createdAt: Readonly<string>;
  originalFps?: Readonly<number>;
  subType: Readonly<SubType>; // In future this could have stuff like IR/EO
  multiCamMedia: Readonly<MultiCamMedia | null>;
}

interface Api {
  getPipelineList(): Promise<Pipelines>;
  runPipeline(itemId: string, pipeline: Pipe): Promise<unknown>;
  deleteTrainedPipeline(pipeline: Pipe): Promise<void>;
  exportTrainedPipeline(path: string, pipeline: Pipe): Promise<unknown>;

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
  openFromDisk(datasetType: DatasetType | 'bulk' | 'calibration' | 'annotation' | 'text' | 'zip', directory?: boolean):
    Promise<{canceled?: boolean; filePaths: string[]; fileList?: File[]; root?: string}>;
  getTiles?(itemId: string, projection?: string): Promise<StringKeyObject>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTileURL?(itemId: string, x: number, y: number, level: number, query: Record<string, any>):
   string;
  importAnnotationFile(id: string, path: string, file?: File,
    additive?: boolean, additivePrepend?: string, set?: string): Promise<boolean | string[]>;
  // Desktop-only calibration persistence functions
  getLastCalibration?(): Promise<string | null>;
  saveCalibration?(path: string): Promise<{ savedPath: string; updatedDatasetIds: string[] }>;
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
  SubType,
  FrameImage,
  MultiTrackRecord,
  MultiGroupRecord,
  Pipe,
  Pipelines,
  SaveDetectionsArgs,
  SaveAttributeArgs,
  SaveAttributeTrackFilterArgs,
  TrainingConfigs,
  MultiCamMedia,
  MediaImportResponse,
};
