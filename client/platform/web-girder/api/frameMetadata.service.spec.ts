import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import girderRest from 'platform/web-girder/plugins/girder';
import loadFrameMetadata from './frameMetadata.service';

vi.mock('platform/web-girder/plugins/girder', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('loadFrameMetadata', () => {
  beforeEach(() => {
    vi.mocked(girderRest.get).mockReset();
  });

  it('loads shared and camera-local attachments into one normalized response', async () => {
    vi.mocked(girderRest.get).mockImplementation(async (url: string) => {
      if (url === 'dive_dataset/dataset-id/frame_metadata_sources') {
        return {
          data: {
            shared: { itemId: 'shared-id', name: 'shared.csv' },
            cameras: {
              port: { itemId: 'port-id', name: 'port.csv' },
              starboard: { name: 'missing.csv', error: 'Metadata attachment is unavailable.' },
            },
          },
        };
      }
      if (url === 'item/shared-id/download') {
        return { data: 'filename,depth\nport.png,10\n' };
      }
      if (url === 'item/port-id/download') {
        return { data: 'filename,depth\nport.png,99\n' };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(loadFrameMetadata('dataset-id')).resolves.toEqual({
      shared: {
        name: 'shared.csv',
        text: 'filename,depth\nport.png,10\n',
      },
      cameras: {
        port: {
          name: 'port.csv',
          text: 'filename,depth\nport.png,99\n',
        },
        starboard: {
          name: 'missing.csv',
          error: 'Metadata attachment is unavailable.',
        },
      },
    });
  });

  it('does not download an attachment the parser is not allowed to read', async () => {
    vi.mocked(girderRest.get).mockResolvedValueOnce({
      data: {
        shared: { itemId: 'json-id', name: 'pipeline-input.json' },
        cameras: {},
      },
    });

    await expect(loadFrameMetadata('dataset-id')).resolves.toEqual({
      shared: { name: 'pipeline-input.json' },
      cameras: {},
    });
    expect(girderRest.get).toHaveBeenCalledTimes(1);
  });

  it('reports a failed download as an unavailable attachment', async () => {
    vi.mocked(girderRest.get).mockImplementation(async (url: string) => {
      if (url === 'dive_dataset/dataset-id/frame_metadata_sources') {
        return { data: { shared: { itemId: 'gone-id', name: 'nav.csv' }, cameras: {} } };
      }
      throw new Error('404');
    });

    await expect(loadFrameMetadata('dataset-id')).resolves.toEqual({
      shared: { name: 'nav.csv', error: 'Metadata attachment is unavailable.' },
      cameras: {},
    });
  });
});
