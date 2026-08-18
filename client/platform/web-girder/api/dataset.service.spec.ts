import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import girderRest from 'platform/web-girder/plugins/girder';
import { uploadAndSetMetadataFile } from './dataset.service';

vi.mock('platform/web-girder/plugins/girder', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

function metadataFile() {
  return new File(['filename,depth\nimg.png,10\n'], 'metadata.csv', { type: 'text/csv' });
}

describe('uploadAndSetMetadataFile', () => {
  beforeEach(() => {
    vi.mocked(girderRest.get).mockReset();
    vi.mocked(girderRest.post).mockReset();
    vi.mocked(girderRest.put).mockReset();
  });

  it('uploads the file as an item, then declares that item as the attachment', async () => {
    vi.mocked(girderRest.post)
      .mockResolvedValueOnce({ data: { _id: 'item-id' } })
      .mockResolvedValueOnce({ data: { _id: 'upload-id' } })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} });
    vi.mocked(girderRest.put).mockResolvedValueOnce({ data: {} });

    await expect(uploadAndSetMetadataFile('folder-id', metadataFile())).resolves.toBeUndefined();

    expect(vi.mocked(girderRest.post).mock.calls[0][2]).toEqual({
      params: {
        folderId: 'folder-id',
        name: 'metadata.csv',
        metadata: JSON.stringify({ frameMetadata: 'true' }),
      },
    });
    expect(vi.mocked(girderRest.put)).toHaveBeenCalledWith(
      'item/item-id/metadata',
      { frameMetadata: 'true' },
    );
    expect(vi.mocked(girderRest.post).mock.calls[3][0]).toBe('dive_dataset/folder-id/metadata_file');
    expect(vi.mocked(girderRest.post).mock.calls[3][2]).toEqual({ params: { itemId: 'item-id' } });
  });

  it('surfaces a rejected declaration to the caller', async () => {
    const error = { response: { status: 400 } };
    vi.mocked(girderRest.post)
      .mockResolvedValueOnce({ data: { _id: 'item-id' } })
      .mockResolvedValueOnce({ data: { _id: 'upload-id' } })
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(error);
    vi.mocked(girderRest.put).mockResolvedValueOnce({ data: {} });

    await expect(uploadAndSetMetadataFile('folder-id', metadataFile())).rejects.toBe(error);
  });
});
