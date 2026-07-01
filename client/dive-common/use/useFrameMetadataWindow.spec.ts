import { nextTick, ref } from 'vue';

// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  describe, expect, it, vi,
} from 'vitest';

import type { FrameMetadataResponse } from '../apispec';
import { useFrameMetadataWindow } from './useFrameMetadataWindow';

describe('useFrameMetadataWindow', () => {
  it('fetches bounded playhead windows and reads active-camera rows from cache', async () => {
    const datasetId = ref('dataset-id');
    const frame = ref(10);
    const selectedCamera = ref('port');
    const responses: FrameMetadataResponse[] = [
      {
        cameras: {
          port: {
            10: { latitude: '58.10', depth_m: '100' },
            12: { latitude: '58.12', depth_m: '120' },
          },
          starboard: {
            10: { latitude: '59.10', depth_m: '200' },
            12: { latitude: '59.12', depth_m: '220' },
          },
        },
      },
      {
        cameras: {
          port: {
            13: { latitude: '58.13', depth_m: '130' },
          },
          starboard: {
            13: { latitude: '59.13', depth_m: '230' },
          },
        },
      },
    ];
    const loadFrameMetadata = vi.fn(async () => responses.shift() ?? { cameras: {} });

    const metadata = useFrameMetadataWindow({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      windowSize: 5,
    });

    await metadata.ensureFrameLoaded();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(loadFrameMetadata).toHaveBeenLastCalledWith('dataset-id', 8, 12);
    expect(metadata.currentRows.value).toEqual({ latitude: '58.10', depth_m: '100' });

    frame.value = 12;
    await metadata.ensureFrameLoaded();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.currentRows.value).toEqual({ latitude: '58.12', depth_m: '120' });

    selectedCamera.value = 'starboard';
    await metadata.ensureFrameLoaded();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.currentRows.value).toEqual({ latitude: '59.12', depth_m: '220' });

    frame.value = 13;
    await metadata.ensureFrameLoaded();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(loadFrameMetadata).toHaveBeenLastCalledWith('dataset-id', 11, 15);
    expect(metadata.windowRange.value).toEqual({ startFrame: 11, endFrame: 15 });
    expect(metadata.currentRows.value).toEqual({ latitude: '59.13', depth_m: '230' });
    expect(metadata.cameras.value.port[10]).toBeUndefined();
  });

  it('ignores an in-flight response after the dataset is cleared', async () => {
    const datasetId = ref('dataset-id');
    const frame = ref(10);
    const selectedCamera = ref('port');
    let resolveRequest: (response: FrameMetadataResponse) => void = () => {};
    const request = new Promise<FrameMetadataResponse>((resolve) => {
      resolveRequest = resolve;
    });
    const loadFrameMetadata = vi.fn(() => request);

    const metadata = useFrameMetadataWindow({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      windowSize: 5,
    });

    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.loading.value).toBe(true);

    datasetId.value = '';
    await nextTick();

    expect(metadata.loading.value).toBe(false);
    expect(metadata.windowRange.value).toBeNull();

    resolveRequest({
      cameras: {
        port: {
          10: { latitude: 'stale' },
        },
      },
    });
    await request;

    expect(metadata.cameras.value).toEqual({});
    expect(metadata.currentRows.value).toBeNull();
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.windowRange.value).toBeNull();
  });
});
