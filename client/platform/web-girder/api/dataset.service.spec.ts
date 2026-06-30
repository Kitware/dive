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
import { loadFrameMetadata } from './dataset.service';

describe('dataset.service frame metadata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests frame metadata from the parent dataset with explicit window params', async () => {
    const response = { data: { cameras: { port: { 3: { depth: '193.10' } } } } };
    const get = vi.spyOn(girderRest, 'get').mockResolvedValue(response as never);

    await expect(loadFrameMetadata('parent-id/port', 3, 7)).resolves.toBe(response);

    expect(get).toHaveBeenCalledWith('dive_dataset/parent-id/frame_metadata', {
      params: { startFrame: 3, endFrame: 7 },
    });
  });
});
