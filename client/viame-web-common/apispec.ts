import { provide, Ref } from '@vue/composition-api';

import { use } from 'vue-media-annotator/provides';
import Track, { TrackData, TrackId } from 'vue-media-annotator/track';
import { CustomStyle } from 'vue-media-annotator/use/useStyling';

const ApiSymbol = Symbol('api');
const DatasetIdSymbol = Symbol('datasetId');

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

type Pipelines = Record<string, Category>;

interface SaveDetectionsArgs {
  delete: TrackId[];
  upsert: Map<TrackId, Track>;
}

interface DatasetMetaMutable {
  customTypeStyling?: Record<string, CustomStyle>;
  confidenceFilters?: Record<string, number>;
}

interface DatasetMeta extends DatasetMetaMutable {
  type: Readonly<'video' | 'image-sequence'>;
  fps: Readonly<number | string>;
}

interface Api {
  getAttributes(): Promise<Attribute[]>;

  getPipelineList(): Promise<Pipelines>;
  runPipeline(itemId: string, pipeline: string): Promise<unknown>;

  loadDetections(datasetId: string): Promise<{ [key: string]: TrackData }>;
  saveDetections(datasetId: string, args: SaveDetectionsArgs): Promise<unknown>;

  loadMetadata(datasetId: string): Promise<DatasetMeta>;
  saveMetadata(datasetId: string, metadata: DatasetMetaMutable): Promise<unknown>;
}

/**
 * provideApi specifies an implementation of the data persistence interface
 * for use in vue-web-common
 * @param api an api implementation
 * @param datasetId an arbitrary string identifier for the active dataset
 */
function provideApi(api: Api, datasetId: Ref<string>) {
  provide(ApiSymbol, api);
  provide(DatasetIdSymbol, datasetId);
}

function useDatasetId() {
  return use<Readonly<Ref<string>>>(DatasetIdSymbol);
}

function useApi() {
  return use<Readonly<Api>>(ApiSymbol);
}

export {
  Api,
  Attribute,
  DatasetMeta,
  DatasetMetaMutable,
  Pipe,
  Pipelines,
  SaveDetectionsArgs,
  provideApi,
  useApi,
  useDatasetId,
};
