// @vitest-environment jsdom
import {
  composeLargeImageFrameTexture,
  pickOverviewLevel,
  MAX_FRAME_TEXTURE_EDGE,
} from './largeImageFrameTexture';

function stubCanvas2d() {
  // jsdom has no real canvas; stub enough for compositing / abort paths.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  }) as unknown as CanvasRenderingContext2D);
}

describe('pickOverviewLevel', () => {
  it('picks full resolution when the native long edge is under the cap', () => {
    const overview = pickOverviewLevel({
      sizeX: 1024,
      sizeY: 768,
      tileWidth: 256,
      tileHeight: 256,
      levels: 3, // maxLevel = 2
    });
    expect(overview.level).toBe(2);
    expect(overview.outWidth).toBe(1024);
    expect(overview.outHeight).toBe(768);
  });

  it('picks a coarser overview when full res exceeds the cap', () => {
    const overview = pickOverviewLevel({
      sizeX: 8192,
      sizeY: 8192,
      tileWidth: 256,
      tileHeight: 256,
      levels: 6, // maxLevel = 5; scale 1 => 8192, scale 4 => 2048
    }, MAX_FRAME_TEXTURE_EDGE);
    expect(overview.outWidth).toBeLessThanOrEqual(MAX_FRAME_TEXTURE_EDGE);
    expect(overview.outHeight).toBeLessThanOrEqual(MAX_FRAME_TEXTURE_EDGE);
    // scale 4 = 2^(5-3) => level 3
    expect(overview.level).toBe(3);
    expect(overview.scale).toBe(4);
  });
});

describe('composeLargeImageFrameTexture', () => {
  beforeEach(() => {
    stubCanvas2d();
  });

  it('composites tiles into a canvas with native width/height for warp math', async () => {
    const loadTile = vi.fn(async () => {
      const tile = document.createElement('canvas');
      tile.width = 256;
      tile.height = 256;
      return tile;
    });
    const texture = await composeLargeImageFrameTexture({
      meta: {
        sizeX: 512,
        sizeY: 256,
        tileWidth: 256,
        tileHeight: 256,
        levels: 2,
      },
      getTileURL: (x, y, level) => `tile://${level}/${x}/${y}`,
      loadTile,
    });
    expect(texture.kind).toBe('image');
    expect(texture.width).toBe(512);
    expect(texture.height).toBe(256);
    expect(texture.source).toBeInstanceOf(HTMLCanvasElement);
    const canvas = texture.source as HTMLCanvasElement;
    // Full res fits under the cap, so overview matches native pixels.
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(256);
    // level 1 (full res): 2x1 tiles
    expect(loadTile).toHaveBeenCalledTimes(2);
    expect(loadTile).toHaveBeenCalledWith('tile://1/0/0', undefined);
    expect(loadTile).toHaveBeenCalledWith('tile://1/1/0', undefined);
  });

  it('aborts when the signal is aborted before completion', async () => {
    const abort = new AbortController();
    const loadTile = vi.fn(async () => {
      abort.abort();
      const tile = document.createElement('canvas');
      tile.width = 1;
      tile.height = 1;
      return tile;
    });
    await expect(composeLargeImageFrameTexture({
      meta: {
        sizeX: 256,
        sizeY: 256,
        tileWidth: 256,
        tileHeight: 256,
        levels: 1,
      },
      getTileURL: () => 'tile://0/0/0',
      loadTile,
      signal: abort.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
