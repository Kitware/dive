import type {
  FrameMetadataAttachmentText,
  FrameMetadataSourcesResponse,
} from 'dive-common/apispec';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import {
  METADATA_ATTACHMENT_UNAVAILABLE,
  isFrameMetadataReadableName,
} from 'dive-common/frameMetadata/readability';
import girderRest from 'platform/web-girder/plugins/girder';

/**
 * One attachment the server located: either it resolved to an item, or it could not be
 * read and carries the reason instead. The two are mutually exclusive.
 */
type FrameMetadataSourceItem =
  | { itemId: string; name: string }
  | { name: string; error: string };

interface FrameMetadataSourceItemsResponse {
  shared?: FrameMetadataSourceItem;
  cameras: Record<string, FrameMetadataSourceItem>;
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

async function loadAttachment(
  item: FrameMetadataSourceItem,
): Promise<FrameMetadataAttachmentText> {
  if ('error' in item) {
    return { name: item.name, error: item.error };
  }
  if (!isFrameMetadataReadableName(item.name)) {
    return { name: item.name };
  }
  try {
    return { name: item.name, text: await downloadItemText(item.itemId) };
  } catch {
    return { name: item.name, error: METADATA_ATTACHMENT_UNAVAILABLE };
  }
}

/**
 * Fetch every attachment the dataset declares, shared and per-camera, in one pass. The eager
 * fetch is intended: the response is the whole dataset's attachment set, cached once, so
 * switching cameras never issues another request.
 */
async function loadFrameMetadata(datasetId: string): Promise<FrameMetadataSourcesResponse> {
  const response = await getFrameMetadataSourceItems(datasetId);
  const cameraEntries = await Promise.all(
    Object.entries(response.cameras ?? {}).map(async ([camera, item]) => (
      [camera, await loadAttachment(item)] as const
    )),
  );
  return {
    ...(response.shared ? { shared: await loadAttachment(response.shared) } : {}),
    cameras: Object.fromEntries(cameraEntries),
  };
}

export default loadFrameMetadata;
