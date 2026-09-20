import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { clearCache, extractFrame } from './frameExtraction';

vi.mock('./utils', () => ({ getBinaryPath: (path: string) => path, spawnResult: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));

beforeEach(() => {
  clearCache();
  vi.mocked(spawn).mockReset();
  vi.mocked(spawn).mockImplementation(((_path: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(args[args.indexOf('-ss') + 1]));
      child.emit('close', 0);
    });
    return child;
  }) as typeof spawn);
});

it('does not reuse a cached frame extracted at another timestamp', async () => {
  expect((await extractFrame('clip.mp4', 10, 5)).toString()).toBe('2.000000');
  expect((await extractFrame('clip.mp4', 10, 30)).toString()).toBe('0.333333');
  expect((await extractFrame('clip.mp4', 60, 30)).toString()).toBe('2.000000');
  expect(spawn).toHaveBeenCalledTimes(2);
});
