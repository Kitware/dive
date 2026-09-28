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
  resolveReviewDatasetId,
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

  it('keeps a standalone dataset under an ordinary folder', async () => {
    vi.spyOn(girderRest, 'get')
      .mockResolvedValueOnce({ data: { parentId: 'ordinary', parentCollection: 'folder' } } as never)
      .mockResolvedValueOnce({ data: { meta: {} } } as never);
    expect(await resolveReviewDatasetId('standalone')).toBe('standalone');
  });

  it('does not include unrelated datasets nested beneath a stereo parent', async () => {
    vi.spyOn(girderRest, 'get')
      .mockResolvedValueOnce({ data: { parentId: 'rig', parentCollection: 'folder' } } as never)
      .mockResolvedValueOnce({
        data: {
          meta: {
            type: 'multi', multiCam: { cameras: { left: { folderId: 'left' } } },
          },
        },
      } as never);
    expect(await resolveReviewDatasetId('unrelated')).toBe('unrelated');
  });

  it('does not resolve a collection id as a folder', async () => {
    const get = vi.spyOn(girderRest, 'get').mockResolvedValueOnce({
      data: { parentId: 'collection', parentCollection: 'collection' },
    } as never);
    expect(await resolveReviewDatasetId('standalone')).toBe('standalone');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
