import girderRest from 'platform/web-girder/plugins/girder';

async function getTilesMetadata(itemId: string) {
  const { data } = await girderRest.get(`item/${itemId}/tiles/internal_metadata?projections=EPSGH%3A3857`);
  return data;
}
async function getTiles(itemId: string) {
  const { data } = await girderRest.get(`item/${itemId}/tiles?projection=EPSG%3A3857`);
  // const { data } = await girderRest.get(`item/${itemId}/tiles?projection=EPSG%3A3857`);
  return data;
}
function getTileURL(
  itemId: string, x: number, y: number, level: number, query: Record<string, any>,
) {
  let url = `${girderRest.apiRoot}/item/${itemId}/tiles/zxy/${level}/${x}/${y}`;
  if (query) {
    const params = Object.keys(query).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
    url += `?${params}`;
  }
  return url;
}

export {
  getTilesMetadata,
  getTiles,
  getTileURL,
};
