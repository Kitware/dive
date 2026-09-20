import { createNativeFrameRenderer, nativeVideoSourceFrame, nativeVideoMaxFrame } from './nativeVideoFrames';

it('maps annotation frames onto source frames and limits navigation to existing images', () => {
  expect(nativeVideoSourceFrame(10, 5, 30)).toBe(60);
  expect(nativeVideoSourceFrame(1, 7, 30)).toBe(5);
  expect(nativeVideoMaxFrame(300, 5, 30)).toBe(49);
  expect(nativeVideoMaxFrame(300, 30, 30)).toBe(299);
  const last = nativeVideoMaxFrame(301, 7, 30);
  expect(nativeVideoSourceFrame(last, 7, 30)).toBeLessThan(301);
  expect(nativeVideoSourceFrame(last + 1, 7, 30)).toBeGreaterThanOrEqual(301);
});

it('keeps a late older decode from replacing a newer frame', async () => {
  type Release = (image: string) => void;
  const release = new Map<number, Release>();
  const draw = vi.fn();
  const renderer = createNativeFrameRenderer((frame) => new Promise<string>((resolve) => { release.set(frame, resolve); }), draw);
  const oldFrame = renderer.render(1);
  const newFrame = renderer.render(2);
  release.get(2)!('new');
  expect(await newFrame).toBe(true);
  release.get(1)!('old');
  expect(await oldFrame).toBe(false);
  expect(draw.mock.calls).toEqual([['new']]);
});

it.each(['invalidate', 'dispose'] as const)('ignores pending frames after %s', async (action) => {
  let release!: (image: string) => void;
  const draw = vi.fn();
  const renderer = createNativeFrameRenderer(() => new Promise<string>((resolve) => { release = resolve; }), draw);
  const pending = renderer.render(1);
  renderer[action]();
  release('late');
  expect(await pending).toBe(false);
  expect(draw).not.toHaveBeenCalled();
});
