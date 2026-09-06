import type {
  ScoringDatasetSummary,
  ScoringJobArgs,
  ScoringPair,
  ScoringResult,
  ScoringResultSummary,
  ScoringSourceOptions,
} from 'dive-common/apispec';
import type { ScoringSource } from 'dive-common/scoring/types';
import girderRest from 'platform/web-girder/plugins/girder';
import { getDatasetList } from './dataset.service';
import { resolveDatasetFolderId } from './multicamResolve';

/** Datasets offered as the other side of a comparison; enough for one listing. */
const SCORING_DATASET_LIMIT = 500;

async function resolveSource(source: ScoringSource): Promise<ScoringSource> {
  // Composite multicam ids (parent/camera) resolve to the camera folder, which
  // is where that camera's annotations live.
  const { folderId } = await resolveDatasetFolderId(source.datasetId);
  return { ...source, datasetId: folderId };
}

async function resolvePair(pair: ScoringPair): Promise<ScoringPair> {
  const [computed, truth] = await Promise.all([
    resolveSource(pair.computed),
    resolveSource(pair.truth),
  ]);
  return { computed, truth };
}

async function runScoring(args: ScoringJobArgs) {
  const pairs = await Promise.all(args.pairs.map(resolvePair));
  return girderRest.post('dive_rpc/score', { ...args, pairs });
}

async function listScoringResults(datasetId?: string) {
  if (datasetId === undefined) {
    return girderRest.get<ScoringResultSummary[]>('dive_scoring');
  }
  const { folderId } = await resolveDatasetFolderId(datasetId);
  return girderRest.get<ScoringResultSummary[]>(`dive_dataset/${folderId}/scoring`);
}

async function loadScoringResult(datasetId: string, resultId: string) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  return girderRest.get<ScoringResult>(`dive_dataset/${folderId}/scoring/${resultId}`);
}

async function deleteScoringResult(datasetId: string, resultId: string): Promise<void> {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  await girderRest.delete(`dive_dataset/${folderId}/scoring/${resultId}`);
}

async function listScoringSources(datasetId: string) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  return girderRest.get<ScoringSourceOptions>(`dive_dataset/${folderId}/scoring_sources`);
}

async function listScoringDatasets(): Promise<ScoringDatasetSummary[]> {
  const { data } = await getDatasetList(SCORING_DATASET_LIMIT, 0, 'name', 1);
  return data
    // A multicamera parent exports its annotations as a zip of per-camera
    // files, which the score tool cannot read; its cameras are listed instead.
    .filter((folder) => folder.meta?.type !== 'multi')
    .map((folder) => ({
      id: folder._id,
      name: folder.name,
      type: typeof folder.meta?.type === 'string' ? folder.meta.type : undefined,
    }));
}

export {
  runScoring,
  listScoringResults,
  loadScoringResult,
  deleteScoringResult,
  listScoringSources,
  listScoringDatasets,
};

/** Browser download; the user's download settings decide the destination. */
async function saveScoringExport(
  { filename, mime, content }: { filename: string; mime: string; content: string },
): Promise<boolean> {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** The browser's print dialog offers "Save as PDF"; the page carries print styles. */
async function exportScoringPdf(): Promise<boolean> {
  window.print();
  return true;
}

export { saveScoringExport, exportScoringPdf };
