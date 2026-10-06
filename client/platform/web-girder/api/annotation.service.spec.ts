import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import girderRest from 'platform/web-girder/plugins/girder';
import { loadReviewTracks } from './annotation.service';
import { resolveDatasetFolderId } from './multicamResolve';

vi.mock('platform/web-girder/plugins/girder', () => ({ default: { get: vi.fn() } }));
vi.mock('./multicamResolve', () => ({ resolveDatasetFolderId: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe('web review annotations', () => {
  it('resolves camera folders and fetches only tracks using the authenticated client', async () => {
    vi.mocked(resolveDatasetFolderId).mockResolvedValue({ folderId: 'camera', compositeId: 'parent/left' });
    const tracks = [{ id: 1 }];
    vi.mocked(girderRest.get).mockResolvedValue({ data: tracks });
    await expect(loadReviewTracks('parent/left')).resolves.toBe(tracks);
    expect(resolveDatasetFolderId).toHaveBeenCalledWith('parent/left');
    expect(girderRest.get).toHaveBeenCalledExactlyOnceWith('dive_annotation/track', {
      params: { folderId: 'camera' },
    });
  });

  it('propagates denied access', async () => {
    vi.mocked(resolveDatasetFolderId).mockResolvedValue({ folderId: 'private', compositeId: null });
    vi.mocked(girderRest.get).mockRejectedValue(new Error('Forbidden'));
    await expect(loadReviewTracks('private')).rejects.toThrow('Forbidden');
  });
});
