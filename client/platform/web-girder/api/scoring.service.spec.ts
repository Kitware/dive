import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import { DEFAULT_SCORING_PARAMS } from 'dive-common/scoring/metrics';
import girderRest from 'platform/web-girder/plugins/girder';
import { clearMultiCamMetaCache } from './multicamResolve';
import {
  deleteScoringResult, listScoringDatasets, listScoringResults, runScoring,
} from './scoring.service';

vi.mock('platform/web-girder/plugins/girder', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('scoring.service', () => {
  beforeEach(() => {
    vi.mocked(girderRest.get).mockReset();
    vi.mocked(girderRest.post).mockReset();
    vi.mocked(girderRest.delete).mockReset();
    clearMultiCamMetaCache();
  });

  it('posts every pair with composite camera ids resolved to camera folders', async () => {
    vi.mocked(girderRest.get).mockResolvedValue({
      data: {
        meta: {
          multiCam: {
            defaultDisplay: 'left',
            cameras: { left: { folderId: 'left-folder' }, right: { folderId: 'right-folder' } },
          },
        },
      },
    });
    vi.mocked(girderRest.post).mockResolvedValueOnce({ data: { _id: 'job' } });

    await runScoring({
      pairs: [
        {
          computed: { datasetId: 'parent/left', set: 'detector' },
          truth: { datasetId: 'truth-id', revision: 4 },
        },
        {
          computed: { datasetId: 'parent/right', set: 'detector' },
          truth: { datasetId: 'parent/right' },
        },
      ],
      params: DEFAULT_SCORING_PARAMS,
      title: 'left vs truth (+1 more)',
    });

    expect(girderRest.post).toHaveBeenCalledWith('dive_rpc/score', {
      pairs: [
        {
          computed: { datasetId: 'left-folder', set: 'detector' },
          truth: { datasetId: 'truth-id', revision: 4 },
        },
        {
          computed: { datasetId: 'right-folder', set: 'detector' },
          truth: { datasetId: 'right-folder' },
        },
      ],
      params: DEFAULT_SCORING_PARAMS,
      title: 'left vs truth (+1 more)',
    });
  });

  it('lists every readable result when no dataset is given', async () => {
    vi.mocked(girderRest.get).mockResolvedValueOnce({ data: [] });

    await listScoringResults();

    expect(girderRest.get).toHaveBeenCalledWith('dive_scoring');
  });

  it('lists one dataset\'s results through the dataset route', async () => {
    vi.mocked(girderRest.get).mockResolvedValueOnce({ data: [] });

    await listScoringResults('ds');

    expect(girderRest.get).toHaveBeenCalledWith('dive_dataset/ds/scoring');
  });

  it('lists datasets the score tool can read, leaving out multicamera parents', async () => {
    vi.mocked(girderRest.get).mockResolvedValueOnce({
      data: [
        { _id: 'a', name: 'A', meta: { type: 'video' } },
        { _id: 'm', name: 'M', meta: { type: 'multi' } },
        { _id: 'b', name: 'B', meta: {} },
      ],
    });

    await expect(listScoringDatasets()).resolves.toEqual([
      { id: 'a', name: 'A', type: 'video' },
      { id: 'b', name: 'B', type: undefined },
    ]);
  });

  it('deletes a result through the dataset route', async () => {
    vi.mocked(girderRest.delete).mockResolvedValueOnce({ data: null });

    await expect(deleteScoringResult('ds', 'res')).resolves.toBeUndefined();

    expect(girderRest.delete).toHaveBeenCalledWith('dive_dataset/ds/scoring/res');
  });
});
