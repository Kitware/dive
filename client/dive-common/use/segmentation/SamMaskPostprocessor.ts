import * as ort from 'onnxruntime-web';

type FloatTensor = { data: unknown; dims: readonly number[] };

/** Shared SAM2/SAM3 numerical post-processing. The ONNX graph owns candidate
 * selection, two bilinear resizes, unpadding and thresholding; DIVE receives
 * one binary mask for editable polygon extraction. */
export default class SamMaskPostprocessor {
  private constructor(private session: ort.InferenceSession) { /* Created asynchronously. */ }

  static async create(model: string | Uint8Array = '/models/sam_postprocess.onnx') {
    // Decoder outputs are already on CPU. This small graph needs no GPU upload
    // or extra GPU session and works without cross-origin isolation.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(model as string, { executionProviders: ['wasm'] });
    return new SamMaskPostprocessor(session);
  }

  async run(
    logits: FloatTensor,
    scores: FloatTensor,
    original: [number, number],
    reshaped: [number, number],
    padded: [number, number],
  ) {
    if (!(logits.data instanceof Float32Array) || !(scores.data instanceof Float32Array)
      || logits.dims.length !== 5 || logits.dims[0] !== 1 || logits.dims[1] !== 1
      || logits.dims[2] !== scores.data.length || !scores.data.length
      || [...original, ...reshaped, ...padded].some((v) => !Number.isInteger(v) || v <= 0)
      || reshaped[0] > padded[0] || reshaped[1] > padded[1]) {
      throw new Error('Invalid SAM mask output or image dimensions.');
    }
    const size = (values: number[]) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [2]);
    const inputs = {
      logits: new ort.Tensor('float32', logits.data, [1, ...logits.dims.slice(2)]),
      scores: new ort.Tensor('float32', scores.data, [scores.data.length]),
      original_size: size(original),
      reshaped_size: size(reshaped),
      padded_size: size(padded),
    };
    try {
      const outputs = await this.session.run(inputs);
      try {
        return { mask: Uint8Array.from(outputs.mask.data as Uint8Array), score: Number(outputs.score.data[0]) };
      } finally { Object.values(outputs).forEach((tensor) => tensor.dispose()); }
    } finally { Object.values(inputs).forEach((tensor) => tensor.dispose()); }
  }

  dispose() { return this.session.release(); }
}
