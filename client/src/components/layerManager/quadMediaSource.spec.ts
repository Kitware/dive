// @vitest-environment jsdom
import { ref } from 'vue';
import { getCameraQuadMedia } from './quadMediaSource';
import type { CameraImage } from '../../layers/cameraImage';

describe('getCameraQuadMedia', () => {
  it('returns the quad image when the annotator has a media quad', () => {
    const img = { naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement;
    const feature = {
      data: () => [{ image: img }],
    };
    const layer = {
      features: () => [feature],
    };
    const controller = {
      geoViewerRef: { value: { layers: () => [layer] } },
      frameTexture: { value: null },
    };
    expect(getCameraQuadMedia(() => controller, 'cam')).toEqual({
      source: img,
      kind: 'image',
      width: 100,
      height: 50,
    });
  });

  it('uses frameTexture for tiled large-image annotators', () => {
    const canvas = document.createElement('canvas');
    const texture: CameraImage = {
      source: canvas,
      kind: 'image',
      width: 4096,
      height: 2048,
    };
    const controller = {
      geoViewerRef: { value: { layers: () => [] } },
      frameTexture: ref(texture),
    };
    expect(getCameraQuadMedia(() => controller, 'ir')).toBe(texture);
  });

  it('prefers frameTexture over Align View warp quads that reuse the overview canvas', () => {
    // After Align draws, the map holds warp quads whose `image` is the
    // overview canvas. Scanning those first would report canvas.width as
    // the native size and offset the next warp.
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const texture: CameraImage = {
      source: canvas,
      kind: 'image',
      width: 8192,
      height: 4096,
    };
    const warpFeature = {
      data: () => [{ image: canvas, crop: { x: 1024, y: 512 } }],
    };
    const warpLayer = {
      features: () => [warpFeature],
    };
    const controller = {
      geoViewerRef: { value: { layers: () => [warpLayer] } },
      frameTexture: ref(texture),
    };
    expect(getCameraQuadMedia(() => controller, 'ir')).toBe(texture);
  });

  it('returns null when neither a quad nor a frameTexture is available', () => {
    const controller = {
      geoViewerRef: { value: { layers: () => [] } },
      frameTexture: { value: null },
    };
    expect(getCameraQuadMedia(() => controller, 'cam')).toBeNull();
  });
});
