import { nextTick, ref } from 'vue';

// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import type { FrameMetadataSourcesResponse } from '../apispec';
import {
  __resetFrameMetadataSessionCache, invalidateFrameMetadata, useFrameMetadata,
} from './useFrameMetadata';

// Drain Vue's watcher scheduler and the promise/microtask + macrotask queues so a dataset switch,
// an async source load/resolve, and any lazy per-camera pass all settle before we assert.
async function settle() {
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await nextTick();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}

describe('useFrameMetadata', () => {
  // The module-level session cache (FIX 6) is intentionally global; reset it so no dataset id or
  // resolved payload from one test's mocks leaks into the next.
  beforeEach(() => {
    __resetFrameMetadataSessionCache();
  });

  it('discards a stale response after the dataset switches (stale-response token)', async () => {
    let resolveFirst: (payload: FrameMetadataSourcesResponse) => void = () => {};
    const first = new Promise<FrameMetadataSourcesResponse>((resolve) => { resolveFirst = resolve; });
    const second: FrameMetadataSourcesResponse = {
      cameras: {
        singleCam: [{
          name: 'frame_metadata.csv',
          text: 'filename,label\nimg001.png,second\n',
        }],
      },
    };
    const loadFrameMetadata = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(second);
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraMediaNames,
    });

    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.loading.value).toBe(true);

    datasetId.value = 'dataset-b';
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(metadata.loading.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['label', 'second']]);

    // The stale dataset-a response arrives late; its token no longer matches, so it is ignored.
    resolveFirst({
      cameras: {
        singleCam: [{
          name: 'frame-metadata.txt',
          text: 'filename,label\nimg001.png,stale\n',
        }],
      },
    });
    await settle();
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['label', 'second']]);
    expect(metadata.currentSources.value).toEqual(['frame_metadata.csv']);
    expect(metadata.error.value).toBeNull();
  });

  it('refetches the current dataset when invalidateFrameMetadata fires (explicit import)', async () => {
    const before: FrameMetadataSourcesResponse = { cameras: {} };
    const after: FrameMetadataSourcesResponse = {
      cameras: {
        singleCam: [{
          name: 'nav_2024.csv',
          text: 'filename,depth\nimg001.png,42\n',
        }],
      },
    };
    const loadFrameMetadata = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraMediaNames,
    });

    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.hasMetadataSource.value).toBe(false);

    // An explicit sidecar import bumps the invalidation signal: the same dataset refetches
    // (negative cache dropped) and the new source resolves without a dataset switch.
    invalidateFrameMetadata();
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '42']]);
  });

  it('recovers after a failed load instead of stranding the panel on error (FIX 4)', async () => {
    const good: FrameMetadataSourcesResponse = {
      cameras: {
        port: [{ name: 'nav.csv', text: 'filename,depth\nport001.png,10\n' }],
        starboard: [{ name: 'nav.csv', text: 'filename,depth\nstar001.png,20\n' }],
      },
    };
    // The first load rejects (transient network blip); the next succeeds.
    const loadFrameMetadata = vi.fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(good);
    const getCameraMediaNames = vi.fn((camera: string) => ({
      port: ['port001.png'],
      starboard: ['star001.png'],
    }[camera]));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('port');
    const metadata = useFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraMediaNames,
    });

    await settle();
    // The initial load rejected: the panel is in an error state, not silently "loaded".
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.error.value).not.toBeNull();
    expect(metadata.hasMetadataSource.value).toBe(false);

    // A camera change re-runs ensure(). A failed load must not have committed the dataset as
    // loaded, or this would short-circuit and leave the panel stuck forever; instead it retries.
    selectedCamera.value = 'starboard';
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(metadata.error.value).toBeNull();
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['depth', '20']]);
  });

  it('negative-caches an empty source listing and never refetches until a dataset switch', async () => {
    const loadFrameMetadata = vi.fn(async () => ({ cameras: {} }));
    const getCameraMediaNames = vi.fn(() => [] as string[]);

    const datasetId = ref('dataset-a');
    const frame = ref(10);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraMediaNames,
    });

    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([]);

    // Scrubbing frames and switching cameras on the same dataset must not refetch.
    frame.value = 500;
    await settle();
    frame.value = 5000;
    await settle();
    selectedCamera.value = 'starboard';
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);

    // A dataset switch re-runs source loading.
    datasetId.value = 'dataset-b';
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(loadFrameMetadata).toHaveBeenLastCalledWith('dataset-b');
  });

  it('resolves sidecars against the media list and exposes the current frame row', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      cameras: {
        singleCam: [{
          name: 'frame_metadata.csv',
          text: 'filename,depth\nimg001.png,10\nimg002.png,12\n',
        }],
      },
    }));
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png', 'img002.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraMediaNames,
    });

    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentSources.value).toEqual(['frame_metadata.csv']);
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);

    // Scrubbing re-materializes the row lazily from held data, with no refetch.
    frame.value = 1;
    await nextTick();
    expect(metadata.currentEntries.value).toEqual([['filename', 'img002.png'], ['depth', '12']]);
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);

    // A frame with no matching row shows nothing (empty-state), not blank columns.
    frame.value = 2;
    await nextTick();
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('resolves a multicam camera lazily when its media list loads after selection', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      cameras: {
        port: [{
          name: 'frame_metadata.csv',
          text: 'filename,depth\nport001.png,10\n',
        }],
        starboard: [{
          name: 'frame-metadata.txt',
          text: 'filename,depth\nstar001.png,20\n',
        }],
      },
    }));
    // starboard's ordered media list is not available until it is selected.
    const media: Record<string, string[] | undefined> = {
      port: ['port001.png'],
      starboard: undefined,
    };
    const getCameraMediaNames = vi.fn((camera: string) => media[camera]);

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('port');
    const metadata = useFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraMediaNames,
    });

    await settle();
    // port resolved eagerly; starboard deferred because its media list was not yet available.
    expect(metadata.currentEntries.value).toEqual([['filename', 'port001.png'], ['depth', '10']]);

    // The media list arrives and the user selects starboard: it resolves on selection.
    media.starboard = ['star001.png'];
    selectedCamera.value = 'starboard';
    await settle();
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentSources.value).toEqual(['frame-metadata.txt']);
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['depth', '20']]);
    // No source refetch across the whole interaction.
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });

  it('follows the active camera for currentSources and hasMetadataSource', async () => {
    const loadFrameMetadata = vi.fn(async (): Promise<FrameMetadataSourcesResponse> => ({
      cameras: {
        port: [
          { name: 'frame_metadata.csv', text: 'filename,latitude\nport001.png,58.10\n' },
          { name: 'frame-metadata.txt', text: 'filename,latitude\nport001.png,99.00\n' },
        ],
        starboard: [
          { name: 'frame_metadata.csv', text: 'filename,latitude\nstar001.png,59.10\n' },
        ],
      },
    }));
    const getCameraMediaNames = vi.fn((camera: string) => ({
      port: ['port001.png'],
      starboard: ['star001.png'],
    }[camera]));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('port');
    const metadata = useFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraMediaNames,
    });

    await settle();
    expect(metadata.currentSources.value).toEqual(['frame_metadata.csv', 'frame-metadata.txt']);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['filename', 'port001.png'], ['latitude', '58.10']]);

    selectedCamera.value = 'starboard';
    await nextTick();
    expect(metadata.currentSources.value).toEqual(['frame_metadata.csv']);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['latitude', '59.10']]);

    selectedCamera.value = 'stern';
    await nextTick();
    expect(metadata.currentSources.value).toEqual([]);
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('resolves the single camera once its initially-empty media list populates (reactive retry)', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      cameras: {
        singleCam: [{
          name: 'frame_metadata.csv',
          text: 'filename,depth\nimg001.png,10\n',
        }],
      },
    }));
    // Mirrors Viewer.vue: imageData (and so getCameraMediaNames) starts at `[]`, not `undefined`.
    const media = ref<string[]>([]);
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? media.value : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraMediaNames,
    });

    await settle();
    // The sidecar source is loaded, but an empty media list must defer, not claim-and-drop it.
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.hasSidecarItems.value).toBe(true);

    // The media list populates later, with no dataset/camera change; the reactive retry resolves.
    media.value = ['img001.png'];
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);
  });

  it('exposes hasSidecarItems for a present sidecar whose rows match no media filename', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      cameras: {
        singleCam: [{
          name: 'frame_metadata.csv',
          text: 'filename,depth\nother001.png,10\n',
        }],
      },
    }));
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraMediaNames,
    });

    await settle();
    expect(metadata.hasSidecarItems.value).toBe(true);
    expect(metadata.sidecarSourceNames.value).toEqual(['frame_metadata.csv']);
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('reuses the module-level session cache across composable instances (panel remount)', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      cameras: {
        singleCam: [{
          name: 'frame_metadata.csv',
          text: 'filename,depth\nimg001.png,10\n',
        }],
      },
    }));
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const options = {
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraMediaNames,
    };

    const first = useFrameMetadata(options);
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(first.hasMetadataSource.value).toBe(true);

    // SidebarContext.vue mounts DatasetInfo with v-if: closing/reopening the panel destroys and
    // re-creates this composable. A second instance for the same dataset must hydrate from the
    // module cache rather than reloading the sidecar.
    const second = useFrameMetadata(options);
    await settle();

    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(second.hasMetadataSource.value).toBe(true);
    expect(second.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);
  });
});
