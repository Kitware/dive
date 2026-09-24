import { ref } from 'vue';
import CameraStore from '../../CameraStore';
import type { Handler } from '../../provides';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';
import routeMulticamEditToCamera from './useMulticamEditRouting';

function makeTwoCameraStore() {
  const store = new CameraStore({ markChangesPending: vi.fn() });
  store.removeCamera('singleCam');
  store.addCamera('left');
  store.addCamera('right');
  return store;
}

function routeDraw(options: {
  cameraStore: CameraStore;
  fromCamera: string;
  toCamera: string;
  trackId: number;
  frame?: number;
}) {
  const {
    cameraStore, fromCamera, toCamera, trackId, frame = 0,
  } = options;
  const selectedCamera = ref(fromCamera);
  const selectedTrackIdRef = ref<number | null>(trackId);
  const handler = {
    selectCamera: vi.fn((camera: string) => {
      selectedCamera.value = camera;
    }),
  };
  routeMulticamEditToCamera({
    camera: toCamera,
    selectedCamera,
    frameNumberRef: ref(frame),
    selectedTrackIdRef,
    editingModeRef: ref<false | EditAnnotationTypes>('rectangle'),
    selectedKeyRef: ref(''),
    cameraStore,
    handler: handler as unknown as Handler,
  });
  return { selectedCamera, handler };
}

describe('routeMulticamEditToCamera new-track binding', () => {
  it('moves an undrawn new track onto the camera that receives the first draw', () => {
    const cameraStore = makeTwoCameraStore();
    cameraStore.camMap.value.get('right')!.trackStore.add(0, 'fish', undefined, 0);

    routeDraw({
      cameraStore, fromCamera: 'right', toCamera: 'left', trackId: 0,
    });

    expect(cameraStore.getPossibleTrack(0, 'right')).toBeUndefined();
    expect(cameraStore.getPossibleTrack(0, 'left')).toBeDefined();
    expect(cameraStore.getTrackAll(0)).toHaveLength(1);
  });

  it('extends a detection to another camera with its own types and confidences', () => {
    const cameraStore = makeTwoCameraStore();
    const left = cameraStore.camMap.value.get('left')!.trackStore.add(0, 'fish', undefined, 2);
    left.setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 1, 1] });
    left.confidencePairs = [['fish', 0.62], ['shark', 0.3]];

    routeDraw({
      cameraStore, fromCamera: 'left', toCamera: 'right', trackId: 2,
    });

    expect(cameraStore.getPossibleTrack(2, 'right')?.confidencePairs).toEqual([['fish', 0.62], ['shark', 0.3]]);
  });

  it('keeps a drawn track on the source camera when extending to another camera', () => {
    const cameraStore = makeTwoCameraStore();
    const right = cameraStore.camMap.value.get('right')!.trackStore.add(0, 'fish', undefined, 0);
    right.setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 1, 1] });

    routeDraw({
      cameraStore, fromCamera: 'right', toCamera: 'left', trackId: 0,
    });

    expect(cameraStore.getPossibleTrack(0, 'right')?.features[0]?.bounds).toEqual([0, 0, 1, 1]);
    expect(cameraStore.getPossibleTrack(0, 'left')).toBeDefined();
    expect(cameraStore.getTrackAll(0)).toHaveLength(2);
  });
});
