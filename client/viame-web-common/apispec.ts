import { provide } from '@vue/composition-api';

import { use } from 'vue-media-annotator/provides';
import Track, { TrackData, TrackId } from 'vue-media-annotator/track';
import { CustomStyle } from 'vue-media-annotator/use/useStyling';

const ApiSymbol = Symbol('api');

type DatasetType = 'image-sequence' | 'video';

interface Attribute {
  belongs: 'track' | 'detection';
  datatype: 'text' | 'number' | 'boolean';
  values?: string[];
  name: string;
  _id: string;
}

interface Pipe {
  name: string;
  pipe: string;
  type: string;
}

interface Category {
  description: string;
  pipes: Pipe[];
}

export interface TrainingConfigs {
  configs: string[];
  default: string;
}

type Pipelines = Record<string, Category>;

interface SaveDetectionsArgs {
  delete: TrackId[];
  upsert: Map<TrackId, Track>;
}

interface FrameImage {
  url: string;
  filename: string;
}

interface DatasetMetaMutable {
  customTypeStyling?: Record<string, CustomStyle>;
  confidenceFilters?: Record<string, number>;
}

interface DatasetMeta extends DatasetMetaMutable {
  type: Readonly<DatasetType>;
  fps: Readonly<number | string>;
  imageData: FrameImage[];
  videoUrl: string | undefined;
}

interface Api {
  getAttributes(): Promise<Attribute[]>;
  setAttribute({ addNew, data }: {addNew: boolean | undefined; data: Attribute}): Promise<unknown>;
  deleteAttribute(data: Attribute): Promise<unknown>;

  getPipelineList(): Promise<Pipelines>;
  runPipeline(itemId: string, pipeline: string): Promise<unknown>;

  getTrainingConfigurations(): Promise<TrainingConfigs>;
  runTraining(folderId: string, pipelineName: string, config: string): Promise<unknown>;

  loadDetections(datasetId: string): Promise<{ [key: string]: TrackData }>;
  saveDetections(datasetId: string, args: SaveDetectionsArgs): Promise<unknown>;

  loadMetadata(datasetId: string): Promise<DatasetMeta>;
  saveMetadata(datasetId: string, metadata: DatasetMetaMutable): Promise<unknown>;
}

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
  Api,
  Attribute,
  DatasetMeta,
  DatasetMetaMutable,
  DatasetType,
  FrameImage,
  Pipe,
  Pipelines,
  SaveDetectionsArgs,
  provideApi,
  useApi,
};
