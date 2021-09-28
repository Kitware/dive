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

export {
  SummaryItem,
  getSummary,
};
