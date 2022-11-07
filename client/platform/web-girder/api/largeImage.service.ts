import girderRest from 'platform/web-girder/plugins/girder';

async function getTilesMetadata(itemId: string) {
  const { data } = await girderRest.get(`item/${itemId}/tiles/`);
  return data;
}
async function getTiles(itemId: string, projection = '') {
  let url = `item/${itemId}/tiles`;
  if (projection !== '') {
    url = `${url}?projection=${encodeURIComponent(projection)}`;
  }
  const { data } = await girderRest.get(url);
  return data;
}
function getTileURL(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  itemId: string, x: number, y: number, level: number, query: Record<string, any>,
) {
  let url = `${girderRest.apiRoot}/item/${itemId}/tiles/zxy/${level}/${x}/${y}`;
  if (query) {
    const params = Object.keys(query).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
    url += `?${params}`;
  }
  return url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTileFrames(itemId: string, options: any) {
  const { data } = await girderRest.get(`/item/${itemId}/tiles/tile_frames/quad_info`, options);
  return data;
}

export {
  getTilesMetadata,
  getTiles,
  getTileURL,
  getTileFrames,
};
