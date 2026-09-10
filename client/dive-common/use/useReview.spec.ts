import { nextTick } from 'vue';
import type { TrackData } from 'vue-media-annotator/track';
import type { DatasetConfig } from 'dive-common/apispec';
import { createReviewService, ReviewApi } from './useReview';

vi.mock('dive-common/review/frameSource', () => ({
  createFrameSource: vi.fn(() => ({
    frameCount: 1,
    getFrame: vi.fn(),
    dispose: vi.fn(),
  })),
}));

function track(id: number, pairs: [string, number][], frames: number[]): TrackData {
  return {
    id,
    begin: Math.min(...frames),
    end: Math.max(...frames),
    confidencePairs: pairs,
    attributes: {},
    features: frames.map((frame) => ({
      frame, keyframe: true, bounds: [0, 0, 10, 10],
    })),
  };
}

function config(id: string, overrides: Partial<DatasetConfig> = {}): DatasetConfig {
  return {
    id,
    name: `Dataset ${id}`,
    type: 'image-sequence',
    fps: 1,
    createdAt: '',
    subType: null,
    multiCamMedia: null,
    imageData: [{ url: 'a.jpg', filename: 'a.jpg' }],
    videoUrl: undefined,
    ...overrides,
  } as DatasetConfig;
}

function makeApi(tracksById: Record<string, TrackData[]>, overrides: Partial<ReviewApi> = {}): ReviewApi {
  return {
    loadConfig: vi.fn(async (id: string) => config(id)),
    // Fresh copies each call, as a real platform returns them.
    loadDetections: vi.fn(async (id: string) => ({
      version: 2, tracks: JSON.parse(JSON.stringify(tracksById[id] || [])), groups: [], sets: [],
    })),
    saveDetections: vi.fn(async () => undefined),
    listScoringDatasets: vi.fn(async () => [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]),
    ...overrides,
  };
}

describe('createReviewService', () => {
  it('keeps deferred datasets queued until loadQueued', async () => {
    const api = makeApi({ a: [track(1, [['fish', 0.9]], [0])] });
    const service = createReviewService({ api });
    await service.addDataset('a', { id: 'a', name: 'Alpha' }, { defer: true });
    expect(service.datasets.value.map((d) => d.status)).toEqual(['queued']);
    expect(api.loadDetections).not.toHaveBeenCalled();
    await service.loadQueued();
    expect(service.datasets.value.map((d) => [d.status, d.trackCount])).toEqual([['ready', 1]]);
    expect(api.loadDetections).toHaveBeenCalledTimes(1);
  });

  it('loads datasets, prefers peekConfig, and builds items for a query', async () => {
    const peekConfig = vi.fn(async (id: string) => config(id));
    const api = makeApi({
      a: [track(1, [['fish', 0.9]], [0, 1, 2]), track(2, [['shark', 0.3]], [4])],
    }, { peekConfig });
    const service = createReviewService({ api });
    await service.refreshAvailable();
    await service.addDatasets(['a', 'a']);
    expect(peekConfig).toHaveBeenCalledTimes(1);
    expect(api.loadConfig).not.toHaveBeenCalled();
    expect(service.datasets.value).toHaveLength(1);
    expect(service.datasets.value[0]).toMatchObject({
      id: 'a', name: 'Alpha', status: 'ready', trackCount: 2, croppable: true,
    });
    expect(service.types.value).toEqual(['fish', 'shark']);
    expect(service.items.value.map((i) => i.key)).toEqual(['a#1', 'a#2']);

    service.query.threshold = 0.5;
    service.runQuery();
    expect(service.stale.value).toBe(false);
    expect(service.items.value.map((i) => i.key)).toEqual(['a#1']);
    expect(service.items.value[0].frames).toHaveLength(3);
  });

  it('expands a multicamera parent into its cameras', async () => {
    const api = makeApi({ 'm/left': [track(1, [['fish', 1]], [0])], 'm/right': [] }, {
      loadConfig: vi.fn(async (id: string) => (id === 'm'
        ? config(id, {
          type: 'multi',
          multiCamMedia: {
            defaultDisplay: 'left',
            cameras: {
              left: { type: 'image-sequence', imageData: [], videoUrl: '' },
              right: { type: 'image-sequence', imageData: [], videoUrl: '' },
            },
          },
        })
        : config(id))),
    });
    const service = createReviewService({ api });
    await service.addDataset('m', { id: 'm', name: 'Rig' });
    expect(service.datasets.value.map((d) => [d.id, d.name, d.status])).toEqual([
      ['m/left', 'Rig (left)', 'ready'],
      ['m/right', 'Rig (right)', 'ready'],
    ]);
  });

  it('reassigns and accepts types, tracks pending edits, and saves them', async () => {
    const api = makeApi({
      a: [track(1, [['fish', 0.6], ['shark', 0.4]], [0]), track(2, [['fish', 0.9]], [0])],
    });
    const service = createReviewService({ api });
    await service.addDataset('a');
    service.query.type = 'fish';
    service.query.threshold = 0;
    service.runQuery();
    const first = service.items.value.find((i) => i.trackId === 1)!;
    const second = service.items.value.find((i) => i.trackId === 2)!;

    service.assignType(first, 'shark');
    expect(service.currentType(first)).toEqual({ type: 'shark', confidence: 1 });
    expect(service.trackOf('a', 1)?.confidencePairs).toEqual([['shark', 1]]);
    expect(service.isPending(first)).toBe(true);
    expect(service.pendingCount.value).toBe(1);
    // The grid keeps the item until the query is run again.
    expect(service.items.value).toHaveLength(2);

    service.acceptType(second);
    expect(service.trackOf('a', 2)?.confidencePairs).toEqual([['fish', 1]]);
    expect(service.pendingCount.value).toBe(2);

    await service.save();
    expect(api.saveDetections).toHaveBeenCalledTimes(1);
    const [datasetId, args] = (api.saveDetections as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(datasetId).toBe('a');
    expect(args.tracks.upsert.map((t: TrackData) => t.id).sort()).toEqual([1, 2]);
    expect(args.groups).toEqual({ upsert: [], delete: [] });
    expect(service.pendingCount.value).toBe(0);
    expect(service.error.value).toBeNull();
  });

  it('edits a keyframe box and points, marks the track pending, and refreshes the item', async () => {
    const api = makeApi({ a: [track(1, [['fish', 0.6]], [0, 4])] });
    const service = createReviewService({ api });
    await service.addDataset('a');
    service.query.type = '';
    service.query.threshold = 0;
    service.runQuery();
    const [item] = service.items.value;
    expect(item.primary.bounds).toEqual([0, 0, 10, 10]);

    service.updateGeometry(item, 4, { bounds: [22.4, 8, 2.6, 30], head: [5, 5], tail: [9, 9] });
    const feature = service.trackOf('a', 1)?.features.find((f) => f.frame === 4);
    expect(feature?.bounds).toEqual([3, 8, 22, 30]);
    expect(feature?.head).toEqual([5, 5]);
    const keys = feature?.geometry?.features.map((g) => (g.properties as { key: string }).key).sort();
    expect(keys).toEqual(['HeadTails', 'head', 'tail']);
    expect(item.frames.find((f) => f.frame === 4)).toMatchObject({ bounds: [3, 8, 22, 30], head: [5, 5], tail: [9, 9] });
    expect(item.primary.bounds).toEqual([0, 0, 10, 10]);
    expect(service.isPending(item)).toBe(true);

    service.updateGeometry(item, 4, { tail: null });
    expect(feature?.tail).toBeUndefined();
    expect(feature?.geometry?.features.map((g) => (g.properties as { key: string }).key)).toEqual(['head']);
  });

  it('groups a track across cameras, adds boxes where a side is missing, and deletes tracks', async () => {
    const api = makeApi({ 'm/left': [track(3, [['fish', 1]], [0, 4])], 'm/right': [track(3, [['fish', 1]], [4])] }, {
      loadConfig: vi.fn(async (id: string) => (id === 'm'
        ? config(id, {
          type: 'multi',
          multiCamMedia: {
            defaultDisplay: 'left',
            cameras: {
              left: { type: 'image-sequence', imageData: [], videoUrl: '' },
              right: { type: 'image-sequence', imageData: [], videoUrl: '' },
            },
          },
        })
        : config(id))),
    });
    const service = createReviewService({ api });
    await service.addDataset('m', { id: 'm', name: 'Rig' });
    service.query.threshold = 0;
    service.runQuery();

    expect(service.entries.value).toHaveLength(1);
    const [entry] = service.entries.value;
    expect(entry.labels).toEqual(['left', 'right']);
    expect(service.parentOf('m/right')).toBe('m');
    const right = entry.items[1];
    expect(right.frames.map((f) => f.missing ?? false)).toEqual([true, false]);

    service.addKeyframe(right, 0, right.frames[0].bounds as [number, number, number, number]);
    expect(service.trackOf('m/right', 3)?.features.map((f) => f.frame)).toEqual([0, 4]);
    expect(service.trackOf('m/right', 3)?.begin).toBe(0);
    expect(service.entries.value[0].items[1].frames.every((f) => !f.missing)).toBe(true);
    expect(service.pendingCount.value).toBe(1);

    service.deleteTrack(entry.items[0]);
    service.deleteTrack(entry.items[1]);
    expect(service.entries.value).toHaveLength(0);
    expect(service.pendingCount.value).toBe(2);
    await service.save();
    const { calls } = (api.saveDetections as ReturnType<typeof vi.fn>).mock;
    expect(calls.map(([id, args]) => [id, args.tracks.delete])).toEqual([['m/left', [3]], ['m/right', [3]]]);
    expect(service.pendingCount.value).toBe(0);
  });

  it('reports a failed save and keeps the edits pending', async () => {
    const api = makeApi({ a: [track(1, [['fish', 0.6]], [0])] }, {
      saveDetections: vi.fn(async () => { throw new Error('disk full'); }),
    });
    const service = createReviewService({ api });
    await service.addDataset('a');
    service.runQuery();
    service.assignType(service.items.value[0], 'shark');
    await service.save();
    expect(service.error.value).toBe('disk full');
    expect(service.pendingCount.value).toBe(1);
  });

  it('discards edits by reloading the changed datasets', async () => {
    const api = makeApi({ a: [track(1, [['fish', 0.6]], [0])] });
    const service = createReviewService({ api });
    await service.addDataset('a');
    service.runQuery();
    service.assignType(service.items.value[0], 'shark');
    await service.discardChanges();
    expect(api.loadDetections).toHaveBeenCalledTimes(2);
    expect(service.pendingCount.value).toBe(0);
    expect(service.trackOf('a', 1)?.confidencePairs).toEqual([['fish', 0.6]]);
  });

  it('marks a dataset that failed to load and lets it be removed', async () => {
    const api = makeApi({}, {
      loadDetections: vi.fn(async () => { throw new Error('missing'); }),
    });
    const service = createReviewService({ api });
    await service.addDataset('a');
    expect(service.datasets.value[0]).toMatchObject({ status: 'error', error: 'missing' });
    service.removeDataset('a');
    await nextTick();
    expect(service.datasets.value).toHaveLength(0);
    expect(service.types.value).toEqual([]);
  });
});
