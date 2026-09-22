import { readFileSync } from 'fs';
import SamMaskPostprocessor from './SamMaskPostprocessor';

const modelBytes = () => readFileSync(new URL('../../../public/models/sam_postprocess.onnx', import.meta.url));
let processor: SamMaskPostprocessor;
beforeAll(async () => { processor = await SamMaskPostprocessor.create(modelBytes()); });
afterAll(async () => { await processor?.dispose(); });

it('runs the shipped ONNX graph and selects the highest-scoring mask', async () => {
  const logits = new Float32Array(3 * 8 * 8).fill(-1);
  for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) logits[64 + y * 8 + x] = 1;
  const { mask, score } = await processor.run(
    { data: logits, dims: [1, 1, 3, 8, 8] },
    { data: new Float32Array([0.1, 0.9, 0.3]), dims: [1, 1, 3] },
    [8, 8],
    [8, 8],
    [8, 8],
  );
  expect(score).toBeCloseTo(0.9);
  expect(mask.reduce((sum, v) => sum + v, 0)).toBe(16);
  expect(mask[2 * 8 + 2]).toBe(1);
  expect(mask[0]).toBe(0);
});

it('removes padding before resizing and supports dynamic output dimensions', async () => {
  const logits = new Float32Array(16).fill(-1);
  logits.fill(1, 8); // Only padded rows are foreground.
  const { mask } = await processor.run(
    { data: logits, dims: [1, 1, 1, 4, 4] },
    { data: new Float32Array([0.5]), dims: [1, 1, 1] },
    [3, 7],
    [2, 4],
    [4, 4],
  );
  expect(mask).toEqual(new Uint8Array(21));
});

it('breaks equal-score ties by choosing the first candidate and thresholds strictly above zero', async () => {
  const { mask } = await processor.run(
    { data: new Float32Array([0, 1, 1, 1, -1, -1, -1, -1]), dims: [1, 1, 2, 2, 2] },
    { data: new Float32Array([0.5, 0.5]), dims: [1, 1, 2] },
    [2, 2],
    [2, 2],
    [2, 2],
  );
  expect([...mask]).toEqual([0, 1, 1, 1]);
});
