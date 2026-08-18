import { effectScope, nextTick, ref } from 'vue';

import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import type { FrameMetadataSourcesResponse } from '../apispec';
import type { FrameMetadataFrameContext } from '../frameMetadata/resolve';
import { resetFrameMetadataSessionCache, useFrameMetadata } from './useFrameMetadata';

// Drain Vue's watcher scheduler and the promise/microtask + macrotask queues so a dataset switch,
// an async source load/resolve, and any deferred per-camera pass all settle before we assert.
async function settle() {
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await nextTick();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}

/**
 * Stand in for the component that owns the composable in production: `onScopeDispose` binds to
 * whatever effect scope is active, which for a real panel is its `setup()`. Every instance here
 * gets one so the composable never has to make an allowance for its tests. The scope is left
 * running -- a test that exercises teardown stops its own.
 */
function mountFrameMetadata(options: Parameters<typeof useFrameMetadata>[0]) {
  const metadata = effectScope().run(() => useFrameMetadata(options));
  if (metadata === undefined) {
    throw new Error('effect scope did not run');
  }
  return metadata;
}

function frameContextFromMediaNames(
  getMediaNames: (camera: string) => string[] | undefined,
): (camera: string) => FrameMetadataFrameContext | undefined {
  return (camera: string) => {
    const mediaNames = getMediaNames(camera);
    if (mediaNames === undefined || mediaNames.length === 0) {
      return undefined;
    }
    return { mediaType: 'image-sequence', mediaNames };
  };
}

describe('useFrameMetadata', () => {
  // The module-level session cache is intentionally global; reset it so no dataset id or
  // resolved payload from one test's mocks leaks into the next.
  beforeEach(() => {
    resetFrameMetadataSessionCache();
  });

  it('discards a stale response after the dataset switches (stale-response token)', async () => {
    let resolveFirst: (payload: FrameMetadataSourcesResponse) => void = () => {};
    const first = new Promise<FrameMetadataSourcesResponse>((resolve) => { resolveFirst = resolve; });
    const second: FrameMetadataSourcesResponse = {
      shared: {
        name: 'frame_metadata.csv',
        text: 'filename,label\nimg001.png,second\n',
      },
      cameras: {},
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
    const metadata = mountFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
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
      shared: {
        name: 'frame-metadata.txt',
        text: 'filename,label\nimg001.png,stale\n',
      },
      cameras: {},
    });
    await settle();
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['label', 'second']]);
    expect(metadata.resolvedSourceName.value).toBe('frame_metadata.csv');
    expect(metadata.error.value).toBeNull();
  });

  it('recovers after a failed load instead of stranding the panel on error', async () => {
    const good: FrameMetadataSourcesResponse = {
      cameras: {
        port: { name: 'nav.csv', text: 'filename,depth\nport001.png,10\n' },
        starboard: { name: 'nav.csv', text: 'filename,depth\nstar001.png,20\n' },
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
    const metadata = mountFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    // The initial load rejected: the panel is in an error state, not silently "loaded".
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.error.value).not.toBeNull();
    expect(metadata.attachmentState.value).toBe('none');

    // A camera change re-runs ensure(). A failed load must not have committed the dataset as
    // loaded, or this would short-circuit and leave the panel stuck forever; instead it retries.
    selectedCamera.value = 'starboard';
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(metadata.error.value).toBeNull();
    expect(metadata.attachmentState.value).toBe('resolved');
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['depth', '20']]);
  });

  it('negative-caches an empty source listing and never refetches until a dataset switch', async () => {
    const loadFrameMetadata = vi.fn(async () => ({ cameras: {} }));
    const getCameraMediaNames = vi.fn(() => [] as string[]);

    const datasetId = ref('dataset-a');
    const frame = ref(10);
    const selectedCamera = ref('singleCam');
    const metadata = mountFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.attachmentState.value).toBe('none');
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

  it('negative-caches an empty source listing across a panel remount', async () => {
    const loadFrameMetadata = vi.fn(async () => ({ cameras: {} }));
    const options = {
      datasetId: ref('dataset-a'),
      frame: ref(0),
      selectedCamera: ref('singleCam'),
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(() => ['img001.png']),
    };

    const first = mountFrameMetadata(options);
    await settle();
    expect(first.attachmentState.value).toBe('none');

    // A dataset with no attachment is the cheapest thing to remember and the most common: closing
    // and reopening the panel must read it back from the session cache, not re-list the sources.
    const second = mountFrameMetadata(options);
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(second.attachmentState.value).toBe('none');
  });

  it('resolves attachments against the media list and exposes the current frame row', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'frame_metadata.csv',
        text: 'filename,depth\nimg001.png,10\nimg002.png,12\n',
      },
      cameras: {},
    }));
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png', 'img002.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = mountFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.attachmentState.value).toBe('resolved');
    expect(metadata.resolvedSourceName.value).toBe('frame_metadata.csv');
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
        port: {
          name: 'frame_metadata.csv',
          text: 'filename,depth\nport001.png,10\n',
        },
        starboard: {
          name: 'frame-metadata.txt',
          text: 'filename,depth\nstar001.png,20\n',
        },
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
    const metadata = mountFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    // port resolved eagerly; starboard deferred because its media list was not yet available.
    expect(metadata.currentEntries.value).toEqual([['filename', 'port001.png'], ['depth', '10']]);

    // The media list arrives and the user selects starboard: it resolves on selection.
    media.starboard = ['star001.png'];
    selectedCamera.value = 'starboard';
    await settle();
    expect(metadata.attachmentState.value).toBe('resolved');
    expect(metadata.resolvedSourceName.value).toBe('frame-metadata.txt');
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['depth', '20']]);
    // No source refetch across the whole interaction.
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });

  it('follows the active camera for the resolved source and its rows', async () => {
    const loadFrameMetadata = vi.fn(async (): Promise<FrameMetadataSourcesResponse> => ({
      cameras: {
        port: { name: 'frame_metadata.csv', text: 'filename,latitude\nport001.png,58.10\n' },
        starboard: { name: 'frame_metadata.csv', text: 'filename,latitude\nstar001.png,59.10\n' },
      },
    }));
    const getCameraMediaNames = vi.fn((camera: string) => ({
      port: ['port001.png'],
      starboard: ['star001.png'],
    }[camera]));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('port');
    const metadata = mountFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    expect(metadata.resolvedSourceName.value).toBe('frame_metadata.csv');
    expect(metadata.attachmentState.value).toBe('resolved');
    expect(metadata.currentEntries.value).toEqual([['filename', 'port001.png'], ['latitude', '58.10']]);

    selectedCamera.value = 'starboard';
    await nextTick();
    expect(metadata.resolvedSourceName.value).toBe('frame_metadata.csv');
    expect(metadata.attachmentState.value).toBe('resolved');
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['latitude', '59.10']]);

    selectedCamera.value = 'stern';
    await nextTick();
    expect(metadata.resolvedSourceName.value).toBeUndefined();
    expect(metadata.attachmentState.value).toBe('none');
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('selects a camera-local attachment as a whole without falling through to shared content', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'shared.csv',
        text: 'filename,depth\nport001.png,10\nstar001.png,20\n',
      },
      cameras: {
        port: {
          name: 'local.csv',
          text: 'filename,depth\nother001.png,99\n',
        },
      },
    }));
    const getCameraMediaNames = vi.fn((camera: string) => ({
      port: ['port001.png'],
      starboard: ['star001.png'],
    }[camera]));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('port');
    const metadata = mountFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    expect(metadata.attachmentName.value).toBe('local.csv');
    expect(metadata.attachmentState.value).toBe('unmatched');
    expect(metadata.currentEntries.value).toEqual([]);

    selectedCamera.value = 'starboard';
    await settle();
    expect(metadata.attachmentName.value).toBe('shared.csv');
    expect(metadata.resolvedSourceName.value).toBe('shared.csv');
    expect(metadata.currentEntries.value).toEqual([['filename', 'star001.png'], ['depth', '20']]);
  });

  it('keeps an unavailable attachment distinct from an unmatched attachment', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'missing.csv',
        error: 'Metadata attachment is unavailable.',
      },
      cameras: {},
    }));
    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = mountFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(() => ['img001.png']),
    });

    await settle();
    expect(metadata.attachmentName.value).toBe('missing.csv');
    expect(metadata.attachmentState.value).toBe('unavailable');
    // `error` is the source-load channel only; an unreadable attachment is a state, not a failure.
    expect(metadata.error.value).toBeNull();
  });

  it.each([
    {
      name: 'opaque JSON',
      attachment: { name: 'pipeline-input.json' },
      expected: 'opaque',
    },
    {
      name: 'invalid CSV',
      attachment: { name: 'broken.csv', text: '' },
      expected: 'invalid',
    },
  ])('classifies an $name attachment distinctly', async ({ attachment, expected }) => {
    const metadata = mountFrameMetadata({
      datasetId: ref('dataset-a'),
      frame: ref(0),
      selectedCamera: ref('singleCam'),
      loadFrameMetadata: vi.fn(async () => ({ shared: attachment, cameras: {} })),
      getCameraFrameContext: frameContextFromMediaNames(() => ['img001.png']),
    });

    await settle();
    expect(metadata.attachmentState.value).toBe(expected);
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('keeps an unavailable attachment visible after a panel remount', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'missing.csv',
        error: 'Metadata attachment is unavailable.',
      },
      cameras: {},
    }));
    const options = {
      datasetId: ref('dataset-a'),
      frame: ref(0),
      selectedCamera: ref('singleCam'),
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(() => ['img001.png']),
    };

    const first = mountFrameMetadata(options);
    await settle();
    expect(first.attachmentState.value).toBe('unavailable');

    const second = mountFrameMetadata(options);
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(second.attachmentState.value).toBe('unavailable');
    expect(second.attachmentName.value).toBe('missing.csv');
  });

  it('shares one in-flight load across camera switches instead of refetching', async () => {
    const response: FrameMetadataSourcesResponse = {
      cameras: {
        port: { name: 'port.csv', text: 'filename,depth\nport001.png,10\n' },
        starboard: { name: 'star.csv', text: 'filename,depth\nstar001.png,20\n' },
      },
    };
    let releaseSecondLoad = () => {};
    const loadFrameMetadata = vi.fn()
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseSecondLoad = () => resolve(response);
      }));
    const media: Record<string, string[] | undefined> = {
      port: ['port001.png'],
      starboard: undefined,
    };
    const getCameraFrameContext = frameContextFromMediaNames((camera) => media[camera]);
    const datasetId = ref('dataset-a');
    const frame = ref(0);

    // The first panel resolves port and parks starboard in `pending`: its media list is missing.
    mountFrameMetadata({
      datasetId, frame, selectedCamera: ref('port'), loadFrameMetadata, getCameraFrameContext,
    });
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);

    // A remount hydrates from the session cache, which holds attachment names but no bytes, so
    // the camera left pending has to refetch them. Camera switches during that download must
    // await the same request instead of downloading every camera's attachment again.
    media.starboard = ['star001.png'];
    const selectedCamera = ref('starboard');
    const second = mountFrameMetadata({
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraFrameContext,
    });
    await nextTick();
    selectedCamera.value = 'port';
    await nextTick();
    selectedCamera.value = 'starboard';
    await nextTick();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);

    releaseSecondLoad();
    await settle();
    expect(second.currentEntries.value).toEqual([['filename', 'star001.png'], ['depth', '20']]);
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
  });

  it('exposes the attachment name for a present attachment whose rows match no media filename', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'frame_metadata.csv',
        text: 'filename,depth\nother001.png,10\n',
      },
      cameras: {},
    }));
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = mountFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    expect(metadata.attachmentName.value).toBe('frame_metadata.csv');
    expect(metadata.attachmentState.value).toBe('unmatched');
    expect(metadata.currentEntries.value).toEqual([]);
  });

  it('resolves the single camera once its initially-empty media list populates (reactive retry)', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'frame_metadata.csv',
        text: 'filename,depth\nimg001.png,10\n',
      },
      cameras: {},
    }));
    // Mirrors Viewer.vue: imageData (and so getCameraMediaNames) starts at `[]`, not `undefined`.
    const media = ref<string[]>([]);
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? media.value : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const metadata = mountFrameMetadata({
      datasetId,
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    });

    await settle();
    // The attachment is loaded, but an empty media list must defer, not claim-and-drop it.
    expect(metadata.attachmentState.value).toBe('pending');
    expect(metadata.attachmentName.value).toBe('frame_metadata.csv');

    // The media list populates later, with no dataset/camera change; the reactive retry resolves.
    media.value = ['img001.png'];
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.attachmentState.value).toBe('resolved');
    expect(metadata.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);
  });

  it('keeps video text pending until its frame bound is ready, then resolves without refetching', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'frame_metadata.csv',
        text: 'frame,depth\n2,30\n0,10\n',
      },
      cameras: {},
    }));
    const ready = ref(false);
    const maxFrame = ref(0);
    const frame = ref(0);
    const metadata = mountFrameMetadata({
      datasetId: ref('dataset-a'),
      frame,
      selectedCamera: ref('singleCam'),
      loadFrameMetadata,
      getCameraFrameContext: () => (
        ready.value
          ? { mediaType: 'video', frameCount: maxFrame.value + 1 }
          : undefined
      ),
    });

    await settle();
    expect(metadata.attachmentState.value).toBe('pending');

    maxFrame.value = 2;
    ready.value = true;
    await settle();
    expect(metadata.currentEntries.value).toEqual([['frame', '0'], ['depth', '10']]);
    expect(metadata.attachmentState.value).toBe('resolved');
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);

    frame.value = 2;
    await settle();
    expect(metadata.currentEntries.value).toEqual([['frame', '2'], ['depth', '30']]);
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });

  it('resolves shared video rows against each camera bound and keeps a local override whole', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'shared.csv',
        text: 'frame,depth\n0,shared-start\n2,shared-long\n',
      },
      cameras: {
        port: {
          name: 'local.csv',
          text: 'frame,depth\n0,local-start\n',
        },
      },
    }));
    const selectedCamera = ref('port');
    const frame = ref(0);
    const frameCounts: Record<string, number> = { port: 1, starboard: 3 };
    const metadata = mountFrameMetadata({
      datasetId: ref('dataset-a'),
      frame,
      selectedCamera,
      loadFrameMetadata,
      getCameraFrameContext: (camera) => ({
        mediaType: 'video',
        frameCount: frameCounts[camera],
      }),
    });

    await settle();
    expect(metadata.resolvedSourceName.value).toBe('local.csv');
    expect(metadata.currentEntries.value).toEqual([['frame', '0'], ['depth', 'local-start']]);

    selectedCamera.value = 'starboard';
    frame.value = 2;
    await settle();
    expect(metadata.resolvedSourceName.value).toBe('shared.csv');
    expect(metadata.currentEntries.value).toEqual([['frame', '2'], ['depth', 'shared-long']]);

    selectedCamera.value = 'port';
    await settle();
    expect(metadata.currentEntries.value).toEqual([]);
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });

  it('reuses the module-level session cache across composable instances (panel remount)', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      shared: {
        name: 'frame_metadata.csv',
        text: 'filename,depth\nimg001.png,10\n',
      },
      cameras: {},
    }));
    const getCameraMediaNames = vi.fn((camera: string) => (
      camera === 'singleCam' ? ['img001.png'] : undefined
    ));

    const datasetId = ref('dataset-a');
    const frame = ref(0);
    const selectedCamera = ref('singleCam');
    const options = {
      datasetId, frame, selectedCamera, loadFrameMetadata, getCameraFrameContext: frameContextFromMediaNames(getCameraMediaNames),
    };

    const first = mountFrameMetadata(options);
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(first.attachmentState.value).toBe('resolved');

    // SidebarContext.vue mounts DatasetInfo with v-if: closing/reopening the panel destroys and
    // re-creates this composable. A second instance for the same dataset must hydrate from the
    // module cache rather than reloading the attachment.
    const second = mountFrameMetadata(options);
    await settle();

    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
    expect(second.attachmentState.value).toBe('resolved');
    expect(second.currentEntries.value).toEqual([['filename', 'img001.png'], ['depth', '10']]);
  });

  it('drops a response that lands after the panel is destroyed', async () => {
    let releaseLoad = () => {};
    const loadFrameMetadata = vi.fn(() => new Promise<FrameMetadataSourcesResponse>((resolve) => {
      releaseLoad = () => resolve({
        shared: { name: 'frame_metadata.csv', text: 'filename,depth\nimg001.png,10\n' },
        cameras: {},
      });
    }));
    const options = {
      datasetId: ref('dataset-a'),
      frame: ref(0),
      selectedCamera: ref('singleCam'),
      loadFrameMetadata,
      getCameraFrameContext: frameContextFromMediaNames(() => ['img001.png']),
    };

    const scope = effectScope();
    const metadata = scope.run(() => useFrameMetadata(options));
    if (metadata === undefined) {
      throw new Error('effect scope did not run');
    }
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);

    // Closing the panel stops the scope while the request is still open.
    scope.stop();
    releaseLoad();
    await settle();
    expect(metadata.attachmentState.value).toBe('none');

    // The destroyed panel wrote nothing to the shared session cache, so the next one refetches.
    const second = mountFrameMetadata(options);
    await settle();
    expect(loadFrameMetadata).toHaveBeenCalledTimes(2);
    expect(second.attachmentState.value).toBe('none');
  });
});
