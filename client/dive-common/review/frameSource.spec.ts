import type { DatasetConfig } from 'dive-common/apispec';
import { createFrameSource } from './frameSource';

function video(overrides: Record<string, unknown> = {}): DatasetConfig {
  return {
    id: 'v',
    name: 'Video',
    type: 'video',
    fps: 10,
    originalFps: 30,
    createdAt: '',
    subType: null,
    multiCamMedia: null,
    imageData: [],
    videoUrl: '',
    ...overrides,
  } as unknown as DatasetConfig;
}

describe('createFrameSource', () => {
  it('reads a natively played video through the platform frame extractor', async () => {
    const urls: string[] = [];
    const nativeFrameUrl = async (path: string, frame: number, fps: number) => {
      urls.push(`${path}#${frame}@${fps}`);
      return `http://frames/${frame}`;
    };
    const source = createFrameSource(video({ nativeVideoPath: '/clips/a.mp4' }), { nativeFrameUrl });
    expect(source.frameCount).toBeNull();
    // Requesting a frame resolves the URL at the video's native rate before loading it.
    await source.getFrame(4).catch(() => undefined);
    expect(urls).toEqual(['/clips/a.mp4#4@30']);
  });

  it('explains why a video cannot be cropped', () => {
    expect(() => createFrameSource(video({ nativeVideoPath: '/clips/a.mp4' })))
      .toThrow('cannot extract frames');
    expect(() => createFrameSource(video())).toThrow('no playable media');
  });
});
