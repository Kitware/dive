import SamOnnx, {
  SAM_MODELS, configureSamOrtProxy, samDevices, samDownloadPercent,
} from './SamOnnx';
import type { SamModelProgress } from './SamOnnx';

const mocks = vi.hoisted(() => {
  class Tensor {
    dispose = vi.fn();

    constructor(public type: string, public data: Uint8Array | Float32Array | BigInt64Array, public dims: number[]) { /* Test tensor. */ }
  }
  const encode = vi.fn();
  const decode = vi.fn();
  const dispose = vi.fn();
  const makeModel = () => Object.assign(async (inputs: unknown) => {
    decode(inputs);
    return {
      pred_masks: new Tensor('float32', new Float32Array(1), [1]),
      iou_scores: new Tensor('float32', new Float32Array([0.1, 0.9, 0.3]), [1, 1, 3]),
    };
  }, { get_image_embeddings: encode, dispose });
  const processor = Object.assign(async () => ({
    pixel_values: new Tensor('float32', new Float32Array(1), [1, 3, 1024, 1024]),
    original_sizes: [[8, 8]],
    reshaped_input_sizes: [[1024, 1024]],
  }), {
    reshape_input_points: () => new Tensor('float32', new Float32Array(2), [1, 1, 1, 2]),
  });
  return {
    Tensor,
    load: vi.fn(),
    encode,
    decode,
    dispose,
    postprocess: vi.fn(),
    releasePostprocess: vi.fn(),
    fromPretrained: vi.fn(),
    makeModel,
    processor,
  };
});
vi.mock('./SamMaskPostprocessor', () => ({
  default: { create: async () => ({ run: mocks.postprocess, dispose: mocks.releasePostprocess }) },
}));
vi.mock('@huggingface/transformers', () => ({
  Tensor: mocks.Tensor,
  RawImage: vi.fn(),
  AutoProcessor: { from_pretrained: async () => mocks.processor },
  Sam2Model: { from_pretrained: (...args: unknown[]) => mocks.fromPretrained(...args) },
  env: { backends: { onnx: { wasm: { proxy: false } } } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encode.mockResolvedValue({ embedding: { dispose: vi.fn() } });
  mocks.postprocess.mockImplementation(async () => {
    const mask = new Uint8Array(64);
    for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) mask[y * 8 + x] = 1;
    return { mask, score: 0.9 };
  });
  mocks.fromPretrained.mockImplementation(async (id: string) => {
    mocks.load(id);
    return mocks.makeModel();
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

it('honors an explicit CPU or GPU preference against hardware capability', async () => {
  const hardware = { requestAdapter: async () => ({ info: { isFallbackAdapter: false } }) };
  const software = { requestAdapter: async () => ({ info: { isFallbackAdapter: true } }) };
  expect(await samDevices(hardware, 'cpu')).toEqual(['wasm']);
  expect(await samDevices(hardware, 'gpu')).toEqual(['webgpu']);
  expect(await samDevices(hardware, 'auto')).toEqual(['webgpu', 'wasm']);
  // Forced GPU still cannot invent a hardware adapter.
  expect(await samDevices(software, 'gpu')).toEqual(['wasm']);
  expect(await samDevices(undefined, 'gpu')).toEqual(['wasm']);
});

it('reloads when the preferred device changes', async () => {
  const sam = new SamOnnx();
  await sam.ready();
  expect(mocks.fromPretrained).toHaveBeenCalledWith(
    SAM_MODELS.sam2,
    expect.objectContaining({ device: 'wasm' }),
  );
  await sam.setDevice('cpu');
  // Same preference is a no-op; switching to auto after a prior load still rebuilds.
  await sam.setDevice('auto');
  await sam.ready();
  expect(mocks.fromPretrained).toHaveBeenCalledTimes(2);
  await sam.dispose();
});

it('enables the ORT wasm proxy only for CPU sessions', () => {
  const onnx = { wasm: { proxy: false } };
  configureSamOrtProxy('wasm', onnx);
  expect(onnx.wasm.proxy).toBe(true);
  configureSamOrtProxy('webgpu', onnx);
  expect(onnx.wasm.proxy).toBe(false);
  configureSamOrtProxy('wasm', undefined);
});

it('aggregates per-file download bytes into a percent', () => {
  expect(samDownloadPercent([{ loaded: 25, total: 100 }, { loaded: 50, total: 100 }])).toBe(37.5);
  expect(samDownloadPercent([])).toBe(0);
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

it('moves from download at 100% to prepare while the session still loads (cached files)', async () => {
  const updates: { message: string | null; progress?: SamModelProgress }[] = [];
  let finishLoad!: (value: object) => void;
  mocks.fromPretrained.mockImplementationOnce((_id: string, options: {
    progress_callback?: (info: {
      status: string; progress?: number; file?: string; loaded?: number; total?: number;
    }) => void;
  }) => new Promise((resolve) => {
    options.progress_callback?.({
      status: 'progress_total', progress: 100, loaded: 10, total: 10,
    });
    finishLoad = resolve;
  }));
  const sam = new SamOnnx((message, progress) => {
    updates.push({ message, progress });
  });
  const ready = sam.ready();
  await vi.waitFor(() => expect(finishLoad).toBeDefined());
  expect(updates.some((u) => u.progress?.phase === 'download' && u.progress.percent === 100)).toBe(true);
  expect(updates.at(-1)).toMatchObject({
    message: expect.stringContaining('Preparing'),
    progress: { phase: 'prepare' },
  });
  finishLoad(mocks.makeModel());
  await ready;
  expect(updates.at(-1)).toEqual({ message: null, progress: undefined });
  await sam.dispose();
});

it('prefers progress_total over per-file progress for the download bar', async () => {
  const updates: SamModelProgress[] = [];
  mocks.fromPretrained.mockImplementationOnce(async (_id: string, options: {
    progress_callback?: (info: {
      status: string; progress?: number; file?: string; loaded?: number; total?: number; name?: string;
    }) => void;
  }) => {
    options.progress_callback?.({
      status: 'progress_total', name: 'm', progress: 40, loaded: 40, total: 100,
    });
    options.progress_callback?.({
      status: 'progress', name: 'm', file: 'a.onnx', progress: 100, loaded: 100, total: 100,
    });
    options.progress_callback?.({
      status: 'progress_total', name: 'm', progress: 100, loaded: 100, total: 100,
    });
    return mocks.makeModel();
  });
  const sam = new SamOnnx((_message, progress) => {
    if (progress) updates.push(progress);
  });
  await sam.ready();
  expect(updates.filter((p) => p.phase === 'download').map((p) => p.percent)).toEqual([0, 40, 100]);
  expect(updates.some((p) => p.phase === 'prepare')).toBe(true);
  await sam.dispose();
});
