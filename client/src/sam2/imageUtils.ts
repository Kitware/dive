/**
 * Image helpers for SAM embed / capture (resize for SAM3 processor input).
 */

export function resizeCanvas(canvasOrig: HTMLCanvasElement, size: { w: number; h: number }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2d context');
  }
  canvas.height = size.h;
  canvas.width = size.w;
  ctx.drawImage(
    canvasOrig,
    0,
    0,
    canvasOrig.width,
    canvasOrig.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

/** Fit source into square target preserving aspect; returns draw rect */
export function resizeAndPadBox(
  sourceDim: { h: number; w: number },
  targetDim: { h: number; w: number },
) {
  if (sourceDim.h === sourceDim.w) {
    return {
      x: 0,
      y: 0,
      w: targetDim.w,
      h: targetDim.h,
    };
  }
  if (sourceDim.h > sourceDim.w) {
    const newW = (sourceDim.w / sourceDim.h) * targetDim.w;
    const padLeft = Math.floor((targetDim.w - newW) / 2);
    return {
      x: padLeft,
      y: 0,
      w: newW,
      h: targetDim.h,
    };
  }
  const newH = (sourceDim.h / sourceDim.w) * targetDim.h;
  const padTop = Math.floor((targetDim.h - newH) / 2);
  return {
    x: 0,
    y: padTop,
    w: targetDim.w,
    h: newH,
  };
}

/**
 * Canvas RGB → Float32 NCHW [1, 3, W, H] normalized 0..1
 */
export function canvasToFloat32Array(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2d context');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const shape = [1, 3, canvas.width, canvas.height];
  const redArray: number[] = [];
  const greenArray: number[] = [];
  const blueArray: number[] = [];
  for (let i = 0; i < imageData.length; i += 4) {
    redArray.push(imageData[i]);
    greenArray.push(imageData[i + 1]);
    blueArray.push(imageData[i + 2]);
  }
  const transposedData = redArray.concat(greenArray).concat(blueArray);
  const float32Array = new Float32Array(shape[1] * shape[2] * shape[3]);
  for (let i = 0; i < transposedData.length; i += 1) {
    float32Array[i] = transposedData[i] / 255.0;
  }
  return { float32Array, shape };
}
