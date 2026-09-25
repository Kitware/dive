import SamOnnx, { SAM_MODELS, samDevices } from './SamOnnx';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), encode: vi.fn(), decode: vi.fn(), dispose: vi.fn(), postprocess: vi.fn(), releasePostprocess: vi.fn(),
}));
vi.mock('./SamMaskPostprocessor', () => ({
  default: { create: async () => ({ run: mocks.postprocess, dispose: mocks.releasePostprocess }) },
}));
vi.mock('@huggingface/transformers', () => {
  class Tensor {
    dispose = vi.fn();

    constructor(public type: string, public data: Uint8Array | Float32Array | BigInt64Array, public dims: number[]) { /* Test tensor. */ }
  }
  const processor = Object.assign(async () => ({
    pixel_values: new Tensor('float32', new Float32Array(1), [1, 3, 1024, 1024]),
    original_sizes: [[8, 8]],
    reshaped_input_sizes: [[1024, 1024]],
  }), {
    reshape_input_points: () => new Tensor('float32', new Float32Array(2), [1, 1, 1, 2]),
  });
  const fromPretrained = async (id: string) => {
    mocks.load(id);
    return Object.assign(async (inputs: unknown) => {
      mocks.decode(inputs);
      return {
        pred_masks: new Tensor('float32', new Float32Array(1), [1]),
        iou_scores: new Tensor('float32', new Float32Array([0.1, 0.9, 0.3]), [1, 1, 3]),
      };
    }, { get_image_embeddings: mocks.encode, dispose: mocks.dispose });
  };
  return {
    Tensor,
    RawImage: vi.fn(),
    AutoProcessor: { from_pretrained: async () => processor },
    Sam2Model: { from_pretrained: fromPretrained },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encode.mockResolvedValue({ embedding: { dispose: vi.fn() } });
  mocks.postprocess.mockImplementation(async () => {
    const mask = new Uint8Array(64);
    for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) mask[y * 8 + x] = 1;
    return { mask, score: 0.9 };
  });
});
const image = { data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 };
const request = { imagePath: 'frame', points: [[4, 4]] as [number, number][], pointLabels: [1] };

it('uses CPU for unavailable/software GPUs, and keeps CPU as a hardware-GPU fallback', async () => {
  expect(await samDevices()).toEqual(['wasm']);
  expect(await samDevices({ requestAdapter: async () => ({ info: { isFallbackAdapter: true } }) })).toEqual(['wasm']);
  expect(await samDevices({ requestAdapter: async () => ({ info: { isFallbackAdapter: false } }) })).toEqual(['webgpu', 'wasm']);
  expect(await samDevices({ requestAdapter: async () => { throw new Error('denied'); } })).toEqual(['wasm']);
});

it('uses ONNX mask post-processing and reuses a frame embedding for negative clicks', async () => {
  const sam = new SamOnnx();
  const first = await sam.predict('left:0', image, request);
  expect(first.success).toBe(true);
  expect(first.bounds).toEqual([2, 2, 6, 6]);
  expect(mocks.postprocess).toHaveBeenCalledWith(expect.anything(), expect.anything(), [8, 8], [1024, 1024], [1024, 1024]);
  await sam.predict('left:0', image, { ...request, points: [[4, 4], [0, 0]], pointLabels: [1, 0] });
  expect(mocks.encode).toHaveBeenCalledTimes(1);
  expect(mocks.decode.mock.calls[1][0].input_labels.data).toEqual(BigInt64Array.from([1, 0], BigInt));
  await sam.dispose();
});

it('releases the previous model and embeddings when switching SAM versions', async () => {
  const sam = new SamOnnx();
  await sam.predict('left:0', image, request);
  await sam.setModel('sam2-small');
  await sam.predict('left:0', image, request);
  expect(mocks.load.mock.calls.map(([id]) => id)).toEqual([SAM_MODELS.sam2, SAM_MODELS['sam2-small']]);
  expect(mocks.dispose).toHaveBeenCalledTimes(1);
  expect(mocks.releasePostprocess).toHaveBeenCalledTimes(1);
  expect(mocks.encode).toHaveBeenCalledTimes(2);
  await sam.dispose();
});

it('discards a prediction when the model changes during encoding', async () => {
  const sam = new SamOnnx();
  let finish!: (value: object) => void;
  mocks.encode.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = sam.predict('left:0', image, request);
  const rejected = expect(pending).rejects.toThrow('Segmentation model changed');
  await vi.waitFor(() => expect(finish).toBeDefined());
  const switched = sam.setModel('sam2-small');
  finish({ embedding: { dispose: vi.fn() } });
  await rejected;
  await switched;
});
