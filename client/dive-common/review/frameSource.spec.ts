import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import type { DatasetConfig } from 'dive-common/apispec';
import { createFrameSource } from './frameSource';

function config(type: DatasetConfig['type']): DatasetConfig {
  return {
    id: 'test',
    createdAt: '',
    subType: null,
    multiCamMedia: null,
    name: 'test',
    type,
    fps: 30,
    videoUrl: '/video.mp4',
    imageData: [{ url: '/0.png', filename: '0.png' }, { url: '/1.png', filename: '1.png' }],
  } as DatasetConfig;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('review frame sources', () => {
  it('deduplicates image reads and evicts frames over the pixel budget', async () => {
    const loads: string[] = [];
    class Image {
      naturalWidth = 100;

      naturalHeight = 100;

      onload = vi.fn();

      set src(url: string) {
        loads.push(url);
        queueMicrotask(() => this.onload());
      }
    }
    vi.stubGlobal('Image', Image);
    const source = createFrameSource(config('image-sequence'), { cacheBytes: 40000 });
    const [first, second] = await Promise.all([source.getFrame(0), source.getFrame(0)]);
    expect(first).toBe(second);
    await source.getFrame(1);
    await source.getFrame(0);
    expect(loads).toEqual(['/0.png', '/1.png', '/0.png']);
    source.dispose();
    await expect(source.getFrame(1)).rejects.toThrow('disposed');
  });

  it('settles video metadata loads on disposal so queued chips can continue', async () => {
    const video = {
      removeAttribute: vi.fn(), load: vi.fn(), preload: '',
    };
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { createElement: () => video });
    const source = createFrameSource(config('video'));
    const pending = source.getFrame(0);
    await Promise.resolve();
    expect(video.preload).toBe('metadata');
    const rejected = expect(pending).rejects.toThrow('Could not open video');
    source.dispose();
    await rejected;
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalledOnce();
    await expect(source.getFrame(1)).rejects.toThrow('disposed');
  });

  it('times out videos whose metadata never arrives', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { createElement: () => ({}) });
    const source = createFrameSource(config('video'));
    const rejected = expect(source.getFrame(0)).rejects.toThrow('Could not open video');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
  });
});
