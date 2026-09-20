/** Map a DIVE annotation frame to the source frame, matching KWIVER downsampling. */
export function nativeVideoSourceFrame(frame: number, frameRate: number, originalFps: number): number {
  const sourceFrame = (frame / frameRate) * originalFps;
  return frameRate < originalFps ? Math.ceil(sourceFrame) : Math.floor(sourceFrame);
}

/** Last annotation frame whose mapped source frame exists. */
export function nativeVideoMaxFrame(frameCount: number, frameRate: number, originalFps: number): number {
  return Math.max(0, frameRate <= originalFps
    ? Math.floor(((frameCount - 1) * frameRate) / originalFps)
    : Math.ceil((frameCount * frameRate) / originalFps) - 1);
}

/** Decode concurrently, but only the latest requested image may replace the display. */
export function createNativeFrameRenderer<T>(
  load: (frame: number) => Promise<T>,
  draw: (image: T) => void,
) {
  let generation = 0;
  let disposed = false;
  return {
    async render(frame: number): Promise<boolean> {
      if (disposed) return false;
      generation += 1;
      const request = generation;
      const image = await load(frame);
      if (disposed || request !== generation) return false;
      draw(image);
      return true;
    },
    invalidate() { generation += 1; },
    dispose() { disposed = true; generation += 1; },
  };
}
