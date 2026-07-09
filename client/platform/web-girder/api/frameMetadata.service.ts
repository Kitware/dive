import type { FrameMetadataSourcesResponse } from 'dive-common/apispec';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import girderRest from 'platform/web-girder/plugins/girder';

interface FrameMetadataSourceItem {
  itemId: string;
  name: string;
}

interface FrameMetadataSourceItemsResponse {
  cameras: Record<string, FrameMetadataSourceItem[]>;
}

async function getFrameMetadataSourceItems(datasetId: string): Promise<FrameMetadataSourceItemsResponse> {
  const folderId = parentDatasetId(datasetId);
  const { data } = await girderRest.get<FrameMetadataSourceItemsResponse>(
    `dive_dataset/${folderId}/frame_metadata_sources`,
  );
  return data;
}

/**
 * Download a Girder item's raw bytes as text over the existing item-download route. Used by the
 * web frame-metadata read path to hand sidecar text to the shared parser. The axios JSON
 * transform is disabled so a numeric-heavy CSV/TXT is returned verbatim, never coerced.
 */
async function downloadItemText(itemId: string): Promise<string> {
  const { data } = await girderRest.get<string>(`item/${itemId}/download`, {
    responseType: 'text',
    transformResponse: [(value: string) => value],
  });
  return typeof data === 'string' ? data : String(data);
}

async function loadFrameMetadata(datasetId: string): Promise<FrameMetadataSourcesResponse> {
  const response = await getFrameMetadataSourceItems(datasetId);
  const textByItemId = new Map<string, Promise<string>>();
  const cameraEntries = await Promise.all(
    Object.entries(response.cameras ?? {}).map(async ([camera, items]) => {
      const sources = await Promise.all(
        items.map(async (item) => {
          let pending = textByItemId.get(item.itemId);
          if (pending === undefined) {
            pending = downloadItemText(item.itemId);
            textByItemId.set(item.itemId, pending);
          }
          return { name: item.name, text: await pending };
        }),
      );
      return [camera, sources] as const;
    }),
  );
  return { cameras: Object.fromEntries(cameraEntries) };
}

export default loadFrameMetadata;
