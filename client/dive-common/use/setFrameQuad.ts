import girderRest from 'platform/web-girder/plugins/girder';
import { getTileFrames } from 'platform/web-girder/api/largeImage.service';

/* eslint-disable prefer-destructuring */
/* eslint-disable max-len */
/* eslint-disable no-shadow */
/* eslint-disable no-empty */
/* eslint-disable no-param-reassign */

interface FrameOptions {
  query: string;
  format: string;
  frameBase: number;
  frameStride: number;
  frameGroup: number;
  frameGroupFactor: number;
  frameGroupStride: number;
  maxTextureSize?: number;
  maxTextures: number;
  maxTotalTexturePixels: number;
  alignment: number;
  adjustMinLevel: boolean;
  maxFrameSize?: number;
  crossOrigin?: string;
  progress: (progress: Status) => number;
  redrawOnFirstLoad: boolean;
}

interface Status {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tileinfo: any; //metadata associated with a tile
  options: FrameOptions;
  images: HTMLImageElement[];
  src: string[];
  quads: Quad[];
  frame?: number;
  frames: number[];
  framesToIdx: Record<string, number>;
  loadedCount: number;
  minLevel: number;
  loaded: boolean;

}
const defaultOptions: FrameOptions = {
  query: 'cache=true',
  format: 'encoding=JPEG&jpegQuality=85&jpegSubsampling=1',
  frameBase: 0,
  frameStride: 1,
  frameGroup: 1,
  frameGroupFactor: 4,
  frameGroupStride: 1,
  maxTextures: 1,
  maxTotalTexturePixels: 1073741824,
  alignment: 16,
  adjustMinLevel: true,
  progress: (status: Status) => (status.frame ? status.frame / status.frames.length : 0),
  redrawOnFirstLoad: true,

};

interface Quad {
  'crop': {
    'bottom': number;
    'left': number;
    'right': number;
    'top': number;
    'x': number;
    'y': number;
  };
  'lr': {
    'x': number;
    'y': number;
    'z': number;
  };
  'ul': {
    'x': number;
    'y': number;
    'z': number;
  };
  image?: HTMLImageElement;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setFrameQuad(itemId: string, tileinfo: any, layer: any, options = defaultOptions) {
  if (!tileinfo || !tileinfo.sizeX || !tileinfo.sizeY || !options) {
    return;
  }
  let maxTextureSize;
  try {
    maxTextureSize = layer.renderer()._maxTextureSize || layer.renderer().constructor._maxTextureSize;
  } catch (err) { }
  options = { maxTextureSize: Math.min(16384, maxTextureSize), ...options };
  const status: Status = {
    tileinfo,
    options,
    images: [],
    src: [],
    quads: [],
    frames: [-1],
    framesToIdx: {},
    loadedCount: 0,
    minLevel: 0,
    loaded: false,
  };
  const qiOptions = { ...options };
  const data = await getTileFrames(itemId, qiOptions);
  status.quads = data.quads;
  status.frames = data.frames;
  status.framesToIdx = data.framesToIdx;
  for (let idx = 0; idx < data.src.length; idx += 1) {
    const img = new Image();
    for (let qidx = 0; qidx < data.quads.length; qidx += 1) {
      if (data.quadsToIdx[qidx] === idx) {
        status.quads[qidx].image = img;
      }
    }
    if (girderRest.apiRoot.indexOf(':') >= 0 && girderRest.apiRoot.indexOf('/') === girderRest.apiRoot.indexOf(':') + 1) {
      img.crossOrigin = options.crossOrigin || 'anonymous';
    }
    const params = Object.keys(data.src[idx]).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(data.src[idx][k])}`).join('&');
    const src = `${girderRest.apiRoot}/item/${itemId}/tiles//tile_frames?${params}`;
    status.src.push(src);
    if (idx === data.src.length - 1) {
      img.onload = () => {
        status.loadedCount += 1;
        status.loaded = true;
        if (layer._options && layer._options.minLevel !== undefined && (options.adjustMinLevel === undefined || options.adjustMinLevel) && status.minLevel && status.minLevel > layer._options.minLevel) {
          layer._options.minLevel = Math.min(layer._options.maxLevel, status.minLevel);
        }
        if (options.progress) {
          try {
            options.progress(status);
          } catch (err) {}
        }
        if (status.frame !== undefined) {
          layer.baseQuad = { ...status.quads[status.framesToIdx[status.frame]] };
          if (options.redrawOnFirstLoad || options.redrawOnFirstLoad === undefined) {
            layer.draw();
          }
        }
      };
    } else {
      ((idx) => {
        img.onload = () => {
          status.loadedCount += 1;
          status.images[idx + 1].src = status.src[idx + 1];
          if (options.progress) {
            try {
              options.progress(status);
            } catch (err) {}
          }
        };
      })(idx);
    }
    status.images.push(img);
  }
  status.images[0].src = status.src[0];
  if (options.progress) {
    try {
      options.progress(status);
    } catch (err) {}
  }

  // eslint-disable-next-line func-names
  layer.setFrameQuad = function (frame: number) {
    if (status.framesToIdx[frame] !== undefined && status.loaded) {
      layer.baseQuad = { ...status.quads[status.framesToIdx[frame]] };
    }
    status.frame = frame;
  };
  layer.setFrameQuad.status = status;
}

export default setFrameQuad;
