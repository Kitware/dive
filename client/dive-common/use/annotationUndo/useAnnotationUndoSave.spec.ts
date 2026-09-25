import { ref } from 'vue';
import CameraStore from 'vue-media-annotator/CameraStore';
import Track from 'vue-media-annotator/track';
import useSave from '../useSave';
import AnnotationHistory from './AnnotationHistory';

const api = vi.hoisted(() => ({
  saveDetections: vi.fn(async () => undefined),
  saveConfig: vi.fn(async () => undefined),
  saveAttributes: vi.fn(async () => undefined),
  saveAttributeTrackFilters: vi.fn(async () => undefined),
}));
vi.mock('dive-common/apispec', () => ({ useApi: () => api }));

it('persists undo after an edit has already been saved through the shared web/desktop API', async () => {
  const saver = useSave(ref('dataset'), ref(false));
  let history: AnnotationHistory;
  const cameras = new CameraStore({
    markChangesPending: (change) => {
      saver.markChangesPending(change);
      history?.record(change);
    },
  });
  history = new AnnotationHistory(cameras);
  const store = cameras.camMap.value.get('singleCam')!.trackStore;
  store.insert(new Track(1, {
    begin: 0,
    end: 0,
    confidencePairs: [['fish', 1]],
    features: [{ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }],
  }), { imported: true });
  history.start();
  store.get(1).setType('shark', 1);
  await saver.save();
  expect(saver.pendingSaveCount.value).toBe(0);
  history.undo();
  expect(saver.pendingSaveCount.value).toBeGreaterThan(0);
  await saver.save();
  expect(api.saveDetections).toHaveBeenLastCalledWith('dataset', expect.objectContaining({
    tracks: { upsert: [expect.objectContaining({ id: 1, confidencePairs: [['fish', 1]] })], delete: [] },
  }));
  expect(saver.pendingSaveCount.value).toBe(0);

  store.remove(1); await saver.save();
  history.undo(); await saver.save();
  expect(api.saveDetections).toHaveBeenLastCalledWith('dataset', expect.objectContaining({
    tracks: { upsert: [expect.objectContaining({ id: 1 })], delete: [] },
  }));
});
