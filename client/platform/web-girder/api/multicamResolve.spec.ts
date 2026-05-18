// @vitest-environment jsdom

// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import girderRest from '../plugins/girder';
import {
  clearMultiCamMetaCache,
  parseCompositeDatasetId,
  resolveDatasetFolderId,
} from './multicamResolve';

describe('multicamResolve', () => {
  beforeEach(() => {
    clearMultiCamMetaCache();
    vi.restoreAllMocks();
  });

  it('parseCompositeDatasetId splits parent and camera', () => {
    expect(parseCompositeDatasetId('parent-id')).toEqual({
      parentId: 'parent-id',
      cameraName: null,
    });
    expect(parseCompositeDatasetId('parent-id/left')).toEqual({
      parentId: 'parent-id',
      cameraName: 'left',
    });
  });

  it('resolveDatasetFolderId returns parent id for non-composite ids', async () => {
    const resolved = await resolveDatasetFolderId('parent-id');
    expect(resolved).toEqual({ folderId: 'parent-id', compositeId: null });
  });

  it('resolveDatasetFolderId maps camera name to child folder id', async () => {
    vi.spyOn(girderRest, 'get').mockResolvedValue({
      data: {
        meta: {
          multiCam: {
            defaultDisplay: 'left',
            cameras: {
              left: { folderId: 'left-folder', type: 'image-sequence' },
              right: { folderId: 'right-folder', type: 'image-sequence' },
            },
          },
        },
      },
    } as never);

    const resolved = await resolveDatasetFolderId('parent-id/right');
    expect(resolved).toEqual({
      folderId: 'right-folder',
      compositeId: 'parent-id/right',
    });
  });

  it('resolveDatasetFolderId throws for unknown camera', async () => {
    vi.spyOn(girderRest, 'get').mockResolvedValue({
      data: {
        meta: {
          multiCam: {
            defaultDisplay: 'left',
            cameras: {
              left: { folderId: 'left-folder', type: 'image-sequence' },
            },
          },
        },
      },
    } as never);

    await expect(resolveDatasetFolderId('parent-id/missing')).rejects.toThrow(
      'Unknown camera "missing"',
    );
  });
});
