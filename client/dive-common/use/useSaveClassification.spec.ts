import { ref } from 'vue';

import CameraStore from 'vue-media-annotator/CameraStore';
import Track, { Feature, TrackData } from 'vue-media-annotator/track';
import type { Attribute } from 'vue-media-annotator/use/AttributeTypes';

import useSave from './useSave';

const apiMocks = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  saveDetections: vi.fn(),
  saveAttributes: vi.fn(),
  saveAttributeTrackFilters: vi.fn(),
}));

vi.mock('dive-common/apispec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dive-common/apispec')>();
  return {
    ...actual,
    useApi: () => apiMocks,
  };
});

const TRACK_ID = 7;

function features(): Feature[] {
  return [{
    frame: 0,
    keyframe: true,
    bounds: [0, 0, 1, 1],
  }];
}

function makeTrack(confidencePairs: [string, number][]) {
  return new Track(TRACK_ID, {
    confidencePairs,
    features: features(),
  });
}

function savedTrack(call: unknown[]): TrackData {
  const payload = call[1] as {
    tracks: { upsert: TrackData[] };
  };
  return payload.tracks.upsert[0];
}

describe('classification save and reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.saveConfig.mockResolvedValue(undefined);
    apiMocks.saveDetections.mockResolvedValue(undefined);
    apiMocks.saveAttributes.mockResolvedValue(undefined);
    apiMocks.saveAttributeTrackFilters.mockResolvedValue(undefined);
  });

  it('persists an ordinary 1.0 confidence edit for a single camera', async () => {
    const saveControls = useSave(ref('single-dataset'), ref(false));
    const cameraStore = new CameraStore({
      markChangesPending: saveControls.markChangesPending,
    });
    cameraStore.camMap.value.get('singleCam')?.trackStore.insert(makeTrack([
      ['fish', 0.8],
      ['shark', 0.2],
    ]), { imported: true });

    cameraStore.setTrackPairConfidence(TRACK_ID, 'shark', 1.0);
    await saveControls.save();

    expect(apiMocks.saveDetections).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveDetections.mock.calls[0][0]).toBe('single-dataset');
    const serialized = savedTrack(apiMocks.saveDetections.mock.calls[0]);
    const reloaded = Track.fromJSON(serialized);
    expect(reloaded.confidencePairs).toEqual([
      ['shark', 1.0],
      ['fish', 0.8],
    ]);
  });

  it('persists synchronized independent vectors for every camera', async () => {
    const saveControls = useSave(ref('multicam-dataset'), ref(false));
    saveControls.removeCamera('singleCam');
    saveControls.addCamera('left');
    saveControls.addCamera('right');
    const cameraStore = new CameraStore({
      markChangesPending: saveControls.markChangesPending,
    });
    cameraStore.removeCamera('singleCam');
    cameraStore.addCamera('left');
    cameraStore.addCamera('right');
    cameraStore.camMap.value.get('left')?.trackStore.insert(makeTrack([
      ['fish', 0.8],
      ['shark', 0.2],
    ]), { imported: true });
    cameraStore.camMap.value.get('right')?.trackStore.insert(makeTrack([
      ['rock', 0.9],
      ['fish', 0.1],
    ]), { imported: true });

    cameraStore.acceptTrackType(TRACK_ID, 'fish');
    await saveControls.save();

    expect(apiMocks.saveDetections.mock.calls.map(([datasetId]) => datasetId))
      .toEqual(['multicam-dataset/left', 'multicam-dataset/right']);
    const [leftData, rightData] = apiMocks.saveDetections.mock.calls.map(savedTrack);
    const leftReloaded = Track.fromJSON(leftData);
    const rightReloaded = Track.fromJSON(rightData);
    expect(leftReloaded.confidencePairs).toEqual([['fish', 1.0]]);
    expect(rightReloaded.confidencePairs).toEqual(leftReloaded.confidencePairs);
    expect(rightReloaded.confidencePairs).not.toBe(leftReloaded.confidencePairs);
    rightReloaded.confidencePairs.forEach((pair) => (
      expect(leftReloaded.confidencePairs).not.toContain(pair)
    ));
  });

  it('persists global attribute definitions after multicamera setup', async () => {
    const saveControls = useSave(ref('multicam-dataset'), ref(false));
    saveControls.removeCamera('singleCam');
    saveControls.addCamera('left');
    saveControls.addCamera('right');
    const trackAttribute: Attribute = {
      belongs: 'track', datatype: 'text', key: 'track_note', name: 'note',
    };
    const detectionAttribute: Attribute = {
      belongs: 'detection', datatype: 'text', key: 'detection_state', name: 'state',
    };

    saveControls.markChangesPending({ action: 'upsert', attribute: trackAttribute });
    saveControls.markChangesPending({ action: 'upsert', attribute: detectionAttribute });
    await saveControls.save();

    expect(apiMocks.saveAttributes).toHaveBeenCalledOnce();
    expect(apiMocks.saveAttributes).toHaveBeenCalledWith('multicam-dataset', {
      upsert: [trackAttribute, detectionAttribute],
      delete: [],
    });
  });
});
