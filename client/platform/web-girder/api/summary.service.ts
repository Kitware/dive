import girderRest from '../plugins/girder';

interface SummaryItem {
  value: string;
  found_in: string[];
  total_tracks: number;
  total_detections: number;
}

async function getSummary() {
  const { data } = await girderRest.get<SummaryItem[]>('viame_summary');
  return data;
}

function getMaxNSummaryUrl(ids: string[]) {
  return `${girderRest.apiRoot}/viame_summary/max_n?folder_ids=${JSON.stringify(ids)}`;
}

export {
  SummaryItem,
  getSummary,
  getMaxNSummaryUrl,
};
