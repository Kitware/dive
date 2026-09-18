import createViewLink from './viewLink';

type Resolver = (camera: string, point: [number, number]) => Promise<[number, number] | null>;

function harness(resolver: Resolver = vi.fn(async () => [30, 40] as [number, number])) {
  const recenter = vi.fn();
  let synced = true;
  const link = createViewLink({
    center: (key) => (key === 'A' ? { x: 10, y: 20 } : undefined),
    cameraName: (key) => ({ A: 'left', B: 'right' } as Record<string, string>)[key],
    recenter,
    synced: () => synced,
    delayMs: 100,
  });
  link.setResolver(resolver);
  return {
    link, recenter, resolver, setSynced: (v: boolean) => { synced = v; },
  };
}

const settle = async () => { await vi.runAllTimersAsync(); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('recentres the other pane on where the source centre lands', async () => {
  const h = harness();
  h.link.schedule('A');
  await settle();
  expect(h.resolver).toHaveBeenCalledWith('left', [10, 20]);
  expect(h.recenter).toHaveBeenCalledWith('A', [30, 40]);
});

it('issues one lookup per settled drag', async () => {
  const h = harness();
  h.link.schedule('A'); vi.advanceTimersByTime(50);
  h.link.schedule('A'); vi.advanceTimersByTime(50);
  h.link.schedule('A');
  await settle();
  expect(h.resolver).toHaveBeenCalledTimes(1);
});

it('leaves the plain sync alone when the point is not found or the lookup throws', async () => {
  const miss = harness(vi.fn(async () => null));
  miss.link.schedule('A'); await settle();
  expect(miss.recenter).not.toHaveBeenCalled();
  const boom = harness(vi.fn(async () => { throw new Error('no model'); }));
  boom.link.schedule('A'); await settle();
  expect(boom.recenter).not.toHaveBeenCalled();
});

it('drops a lookup overtaken by a newer one or finished after sync was turned off', async () => {
  let release: (p: [number, number]) => void = () => undefined;
  const slow: Resolver = () => new Promise<[number, number]>((resolve) => { release = resolve; });
  const h = harness(slow);
  h.link.schedule('A'); vi.advanceTimersByTime(100);
  const firstRelease = release;
  h.link.schedule('A'); vi.advanceTimersByTime(100);
  firstRelease([1, 1]); await Promise.resolve(); await Promise.resolve();
  expect(h.recenter).not.toHaveBeenCalled();
  h.setSynced(false);
  release([2, 2]); await Promise.resolve(); await Promise.resolve();
  expect(h.recenter).not.toHaveBeenCalled();
});

it('does nothing without a resolver or for a pane without a map', async () => {
  const h = harness();
  h.link.schedule('B'); await settle();
  expect(h.resolver).not.toHaveBeenCalled();
  h.link.setResolver(null);
  h.link.schedule('A'); await settle();
  expect(h.resolver).not.toHaveBeenCalled();
});
