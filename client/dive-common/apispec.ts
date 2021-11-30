import { provide } from '@vue/composition-api';

import { use } from 'vue-media-annotator/provides';
import { TrackData, TrackId } from 'vue-media-annotator/track';
import { Attribute } from 'vue-media-annotator/use/useAttributes';
import { CustomStyle } from 'vue-media-annotator/use/useStyling';

type DatasetType = 'image-sequence' | 'video' | 'multi';
type MultiTrackRecord = Record<string, TrackData>;
type SubType = 'stereo' | 'multicam' | null; // Additional type info used for UI display enabled pipelines

interface Pipe {
  name: string;
  pipe: string;
  type: string;
}

interface Category {
  description: string;
  pipes: Pipe[];
}

interface TrainingConfigs {
  configs: string[];
  default: string;
}

type Pipelines = Record<string, Category>;

interface SaveDetectionsArgs {
  delete: TrackId[];
  upsert: TrackData[];
}

interface SaveAttributeArgs {
  delete: string[];
  upsert: Attribute[];
}

interface FrameImage {
  url: string;
  filename: string;
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
  confidenceFilters?: Record<string, number>;
  attributes?: Readonly<Record<string, Attribute>>;
}
const DatasetMetaMutableKeys = ['attributes', 'confidenceFilters', 'customTypeStyling'];

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

  getTrainingConfigurations(): Promise<TrainingConfigs>;
  runTraining(
    folderIds: string[],
    pipelineName: string,
    config: string,
    annotatedFramesOnly: boolean,
    labelText?: string,
  ): Promise<unknown>;

  loadMetadata(datasetId: string): Promise<DatasetMeta>;
  loadDetections(datasetId: string): Promise<MultiTrackRecord>;

  saveDetections(datasetId: string, args: SaveDetectionsArgs): Promise<unknown>;
  saveMetadata(datasetId: string, metadata: DatasetMetaMutable): Promise<unknown>;
  saveAttributes(datasetId: string, args: SaveAttributeArgs): Promise<unknown>;
  // Non-Endpoint shared functions
  openFromDisk(datasetType: DatasetType | 'calibration' | 'annotation' | 'txt' | 'text', directory?: boolean):
    Promise<{canceled?: boolean; filePaths: string[]; fileList?: File[]; root?: string}>;
  importAnnotationFile(id: string, path: string, file?: File): Promise<boolean>;
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
  Api,
  DatasetMeta,
  DatasetMetaMutable,
  DatasetMetaMutableKeys,
  DatasetType,
  SubType,
  FrameImage,
  MultiTrackRecord,
  Pipe,
  Pipelines,
  SaveDetectionsArgs,
  SaveAttributeArgs,
  TrainingConfigs,
  MultiCamMedia,
  MediaImportResponse,
};
