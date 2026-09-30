import type { VideoSearchResult } from 'dive-common/apispec';
import girderRest from 'platform/web-girder/plugins/girder';

export interface QueryHit extends VideoSearchResult {
  datasetId: string;
  key: string;
}
export interface QueryArtifact {
  id: string;
  operation: 'index' | 'search';
  name: string;
  datasetIds: string[];
  jobId?: string;
  ready: boolean;
  method?: string;
  created?: string;
  response?: { results: QueryHit[] };
}
export interface QueryFeedback { positive: string[]; negative: string[] }
export interface SearchRequest {
  operation: 'search';
  indexIds: string[];
  image: string;
  boxes: number[][];
  feedback: QueryFeedback[];
}
export async function listQueryIndexes() {
  return (await girderRest.get<QueryArtifact[]>('dive_query')).data;
}
export async function loadQuery(id: string) {
  return (await girderRest.get<QueryArtifact>(`dive_query/${id}`)).data;
}
export async function loadQueryRequest(id: string) {
  return (await girderRest.get<SearchRequest>(`dive_query/${id}/request`)).data;
}
export async function submitQuery(request: SearchRequest | {
  operation: 'index'; datasetId: string; method: string;
}) {
  return (await girderRest.post<QueryArtifact>('dive_query', request)).data;
}
export async function queryJobStatus(jobId: string) {
  return (await girderRest.get<{ status: number }>(`job/${jobId}`)).data.status;
}

/** Decode in the browser and send only the selected still frame to the worker. */
export function captureQueryImage(source: HTMLImageElement | HTMLVideoElement): string {
  const video = source instanceof HTMLVideoElement;
  const width = video ? source.videoWidth : source.naturalWidth;
  const height = video ? source.videoHeight : source.naturalHeight;
  if (!width || !height) throw new Error('Wait for the image or video frame to load.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot create the exemplar image.');
  context.drawImage(source, 0, 0);
  return canvas.toDataURL('image/png');
}
