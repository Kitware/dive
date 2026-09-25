import * as ort from 'onnxruntime-web';

type Point = [number, number];
export type DisparitySample = { disparity: number; fraction: number } | null;
export type SampleDisparities = (
  data: Float32Array, width: number, height: number, sourceWidth: number, sourceHeight: number,
  points: Point[],
) => Promise<DisparitySample[]>;

/** Small, weight-free ONNX kernel shared by point and line transfer. The dense
 * map is a cached input; all neighbourhood interpolation/filtering/percentile
 * selection stays inside the graph, with only N*49 gathered samples. */
export class DisparitySampler {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private session: ort.InferenceSession) { /* Created asynchronously. */ }

  static async create(model: string | Uint8Array = '/models/stereo_sample.onnx') {
    // The cached dense output is already CPU data. WASM avoids a GPU upload and
    // supports sparse TopK without depending on a GPU's operator coverage.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(model as string, { executionProviders: ['wasm'] });
    return new DisparitySampler(session);
  }

  run: SampleDisparities = async (data, width, height, sourceWidth, sourceHeight, points) => {
    if (![width, height, sourceWidth, sourceHeight].every((v) => Number.isSafeInteger(v) && v > 0)
      || data.length !== width * height) throw new Error('Invalid stereo disparity dimensions.');
    if (!points.length) return [];
    const inputs = {
      disparity: new ort.Tensor('float32', data, [height, width]),
      points: new ort.Tensor('float32', Float32Array.from(points.flat()), [points.length, 2]),
      source_size: new ort.Tensor('float32', Float32Array.from([sourceHeight, sourceWidth]), [2]),
    };
    const work = this.queue.then(async () => {
      const outputs = await this.session.run(inputs);
      try {
        const ds = outputs.disparities.data as Float32Array;
        const fractions = outputs.fractions.data as Float32Array;
        return Array.from(ds, (disparity, i) => (Number.isFinite(disparity) && disparity > 0
          ? { disparity, fraction: fractions[i] } : null));
      } finally { Object.values(outputs).forEach((tensor) => tensor.dispose()); }
    });
    this.queue = work.catch(() => {});
    try { return await work; } finally { Object.values(inputs).forEach((tensor) => tensor.dispose()); }
  };

  async dispose() { await this.queue; await this.session.release(); }
}

// One small kernel session for the application's lifetime, shared across camera
// matchers and model switches. It retains no frame data after a request finishes.
let shared: Promise<DisparitySampler> | null = null;
export const sampleDisparities: SampleDisparities = async (...args) => {
  if (!shared) shared = DisparitySampler.create().catch((error) => { shared = null; throw error; });
  return (await shared).run(...args);
};
