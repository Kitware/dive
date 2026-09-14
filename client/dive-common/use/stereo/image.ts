/**
 * Image -> grayscale helpers for the stereo ONNX matcher. The NCC stage matches
 * VIAME's C++, which derives grayscale from color with OpenCV's BGR2GRAY
 * (BT.601 luma); we apply the same weights to RGBA pixel data.
 */

export interface GrayImage {
  /** Row-major grayscale, length width*height. */
  data: Float32Array;
  width: number;
  height: number;
}

/** RGBA-ish pixel source (ImageData and Canvas getImageData both satisfy this). */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

const R_W = 0.299;
const G_W = 0.587;
const B_W = 0.114;

/** Convert RGBA pixel data to BT.601 grayscale (matches cv2 BGR2GRAY). */
export function rgbaToGray(img: RgbaImage): GrayImage {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = R_W * data[p] + G_W * data[p + 1] + B_W * data[p + 2];
  }
  return { data: out, width, height };
}

/**
 * Draw an image source (HTMLImageElement / HTMLCanvasElement /
 * ImageBitmap) to an offscreen canvas and return BT.601 grayscale. Browser /
 * Electron-renderer only (needs a DOM canvas).
 */
export function drawableToGray(
  source: CanvasImageSource,
  width: number,
  height: number,
): GrayImage {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d canvas context');
  ctx.drawImage(source, 0, 0, width, height);
  return rgbaToGray(ctx.getImageData(0, 0, width, height));
}
