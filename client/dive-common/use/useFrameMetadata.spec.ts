import { nextTick, ref } from 'vue';

// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import type { ResolvedFrameMetadata } from '../apispec';
import { __resetFrameMetadataSessionCache, useFrameMetadata } from './useFrameMetadata';

// Drain Vue's watcher scheduler and the promise/microtask + macrotask queues so a dataset switch,
// an async download/resolve, and any lazy per-camera pass all settle before we assert.
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

  it('discards a stale desktop response after the dataset switches (stale-response token)', async () => {
    let resolveFirst: (payload: ResolvedFrameMetadata) => void = () => {};
    const first = new Promise<ResolvedFrameMetadata>((resolve) => { resolveFirst = resolve; });
    const second: ResolvedFrameMetadata = {
      cameras: { singleCam: { 10: ['second'] } },
      sources: { singleCam: ['second.meta.csv'] },
      columns: { singleCam: ['label'] },
    };
    const loadFrameMetadata = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(second);

    const datasetId = ref('dataset-a');
    const frame = ref(10);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata,
    });

    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.loading.value).toBe(true);

    datasetId.value = 'dataset-b';
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(metadata.loading.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([['label', 'second']]);

    // The stale dataset-a response arrives late; its token no longer matches, so it is ignored.
    resolveFirst({
      cameras: { singleCam: { 10: ['stale'] } },
      sources: { singleCam: ['stale.meta.csv'] },
      columns: { singleCam: ['label'] },
    });
    await settle();
    expect(metadata.currentEntries.value).toEqual([['label', 'second']]);
    expect(metadata.currentSources.value).toEqual(['second.meta.csv']);
    expect(metadata.error.value).toBeNull();
  });

  it('negative-caches an empty web sources listing and never refetches until a dataset switch', async () => {
    const loadFrameMetadataSources = vi.fn(async () => ({ cameras: {} }));
    const downloadItemText = vi.fn(async () => '');
    const getCameraMediaNames = vi.fn(() => [] as string[]);

    const datasetId = ref('dataset-a');
    const frame = ref(10);
    const selectedCamera = ref('singleCam');
    const metadata = useFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadataSources,
      downloadItemText,
      getCameraMediaNames,
    });

    await settle();
    expect(loadFrameMetadataSources).toHaveBeenCalledTimes(1);
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([]);
    expect(downloadItemText).not.toHaveBeenCalled();

    // Scrubbing frames and switching cameras on the same dataset must not refetch.
    frame.value = 500;
    await settle();
    frame.value = 5000;
    await settle();
    selectedCamera.value = 'starboard';
    await settle();
    expect(loadFrameMetadataSources).toHaveBeenCalledTimes(1);

    // A dataset switch re-runs discovery.
    datasetId.value = 'dataset-b';
    await settle();
    expect(loadFrameMetadataSources).toHaveBeenCalledTimes(2);
    expect(loadFrameMetadataSources).toHaveBeenLastCalledWith('dataset-b');
  });

  it('resolves web sidecars against the media list and exposes the current frame row', async () => {
    const loadFrameMetadataSources = vi.fn(async () => ({
      cameras: { singleCam: [{ itemId: 'item-1', name: 'nav.meta.csv' }] },
    }));
    const downloadItemText = vi.fn(async () => 'filename,depth\nimg001.png,10\nimg002.png,12\n');
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
      loadFrameMetadataSources,
      downloadItemText,
      getCameraMediaNames,
    });

    await settle();
    expect(loadFrameMetadataSources).toHaveBeenCalledTimes(1);
    expect(downloadItemText).toHaveBeenCalledWith('item-1');
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentSources.value).toEqual(['nav.meta.csv']);
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);

    // Scrubbing re-materializes the row lazily from held data, with no refetch/redownload.
    frame.value = 1;
    await nextTick();
    expect(metadata.currentEntries.value).toEqual([['filename', 'img002.png'], ['depth', '12']]);
    expect(downloadItemText).toHaveBeenCalledTimes(1);

    // A frame with no matching row shows nothing (empty-state), not blank columns.
    frame.value = 2;
    await nextTick();
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('resolves a multicam camera lazily when its media list loads after selection', async () => {
    const texts: Record<string, string> = {
      'port-item': 'filename,depth\nport001.png,10\n',
      'star-item': 'filename,depth\nstar001.png,20\n',
    };
    const loadFrameMetadataSources = vi.fn(async () => ({
      cameras: {
        port: [{ itemId: 'port-item', name: 'port.meta.csv' }],
        starboard: [{ itemId: 'star-item', name: 'star.meta.csv' }],
      },
    }));
    const downloadItemText = vi.fn(async (itemId: string) => texts[itemId]);
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
      loadFrameMetadataSources,
      downloadItemText,
      getCameraMediaNames,
    });

    await settle();
    // port resolved eagerly; starboard deferred because its media list was not yet available.
    expect(metadata.currentEntries.value).toEqual([['filename', 'port001.png'], ['depth', '10']]);
    expect(downloadItemText).toHaveBeenCalledTimes(1);

    // The media list arrives and the user selects starboard: it resolves on selection.
    media.starboard = ['star001.png'];
    selectedCamera.value = 'starboard';
    await settle();
    expect(downloadItemText).toHaveBeenCalledTimes(2);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentSources.value).toEqual(['star.meta.csv']);
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['depth', '20']]);
    // No source refetch across the whole interaction.
    expect(loadFrameMetadataSources).toHaveBeenCalledTimes(1);
  });

  it('follows the active camera for currentSources and hasMetadataSource (desktop payload)', async () => {
    const loadFrameMetadata = vi.fn(async (): Promise<ResolvedFrameMetadata> => ({
      cameras: {
        port: { 10: ['58.10'] },
        starboard: { 10: ['59.10'] },
      },
      sources: {
        port: ['AUV_telemetry.meta.csv', 'nav.meta.txt'],
        starboard: ['starboard_nav.meta.csv'],
      },
      columns: {
        port: ['latitude'],
        starboard: ['latitude'],
      },
    }));

    const datasetId = ref('dataset-a');
    const frame = ref(10);
    const selectedCamera = ref('port');
    const metadata = useFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata,
    });

    await settle();
    expect(metadata.currentSources.value).toEqual(['AUV_telemetry.meta.csv', 'nav.meta.txt']);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['latitude', '58.10']]);

    selectedCamera.value = 'starboard';
    await nextTick();
    expect(metadata.currentSources.value).toEqual(['starboard_nav.meta.csv']);
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['latitude', '59.10']]);

    selectedCamera.value = 'stern';
    await nextTick();
    expect(metadata.currentSources.value).toEqual([]);
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('resolves the single camera once its initially-empty media list populates (reactive retry)', async () => {
    const loadFrameMetadataSources = vi.fn(async () => ({
      cameras: { singleCam: [{ itemId: 'item-1', name: 'nav.meta.csv' }] },
    }));
    const downloadItemText = vi.fn(async () => 'filename,depth\nimg001.png,10\n');
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
      loadFrameMetadataSources,
      downloadItemText,
      getCameraMediaNames,
    });

    await settle();
    // The sidecar item is listed, but an empty media list must defer, not claim-and-drop it.
    expect(downloadItemText).not.toHaveBeenCalled();
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.hasSidecarItems.value).toBe(true);

    // The media list populates later, with no dataset/camera change; the reactive retry resolves.
    media.value = ['img001.png'];
    await settle();
    expect(downloadItemText).toHaveBeenCalledWith('item-1');
    expect(metadata.hasMetadataSource.value).toBe(true);
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);
  });

  it('exposes hasSidecarItems for a present sidecar whose rows match no media filename', async () => {
    const loadFrameMetadataSources = vi.fn(async () => ({
      cameras: { singleCam: [{ itemId: 'item-1', name: 'nav.meta.csv' }] },
    }));
    // None of this sidecar's rows correspond to an actual media filename in the index.
    const downloadItemText = vi.fn(async () => 'filename,depth\nother001.png,10\n');
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
      loadFrameMetadataSources,
      downloadItemText,
      getCameraMediaNames,
    });

    await settle();
    expect(metadata.hasSidecarItems.value).toBe(true);
    expect(metadata.sidecarSourceNames.value).toEqual(['nav.meta.csv']);
    expect(metadata.hasMetadataSource.value).toBe(false);
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('reuses the module-level session cache across composable instances (panel remount)', async () => {
    const loadFrameMetadataSources = vi.fn(async () => ({
      cameras: { singleCam: [{ itemId: 'item-1', name: 'nav.meta.csv' }] },
    }));
    const downloadItemText = vi.fn(async () => 'filename,depth\nimg001.png,10\n');
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const options = {
      datasetId, frame, selectedCamera, loadFrameMetadataSources, downloadItemText, getCameraMediaNames,
    };

    const first = useFrameMetadata(options);
    await settle();
    expect(loadFrameMetadataSources).toHaveBeenCalledTimes(1);
    expect(downloadItemText).toHaveBeenCalledTimes(1);
    expect(first.hasMetadataSource.value).toBe(true);

    // SidebarContext.vue mounts DatasetInfo with v-if: closing/reopening the panel destroys and
    // re-creates this composable. A second instance for the same dataset must hydrate from the
    // module cache rather than re-listing and re-downloading the sidecar.
    const second = useFrameMetadata(options);
    await settle();

    expect(loadFrameMetadataSources).toHaveBeenCalledTimes(1);
    expect(downloadItemText).toHaveBeenCalledTimes(1);
    expect(second.hasMetadataSource.value).toBe(true);
    expect(second.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);
  });
});
