import girderRest from 'platform/web-girder/plugins/girder';

interface SummaryItem {
  value: string;
  found_in: string[];
  total_tracks: number;
  total_detections: number;
}

async function getSummary() {
  const { data } = await girderRest.get<SummaryItem[]>('dive_summary');
  return data;
}

function getMaxNSummaryUrl(ids: string[]) {
  return girderRest.getUri({
    url: 'dive_summary/max_n',
    params: { folderIds: JSON.stringify(ids) },
  });
}

export {
  SummaryItem,
  getSummary,
  getMaxNSummaryUrl,
};
