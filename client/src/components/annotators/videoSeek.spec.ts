import { frameToVideoTime, videoTimeToFrame } from './videoSeek';

// The presentation timestamp of the video frame a seek to `frame` shows.
function presentedTime(frame: number, frameRate: number, originalFps?: number) {
  const seekTime = frameToVideoTime(frame, frameRate, originalFps);
  return originalFps ? Math.floor(seekTime * originalFps + 1e-6) / originalFps : seekTime;
}

describe('videoTimeToFrame', () => {
  it.each([
    [10, 30],
    [15, 29.97],
    [30, 30],
    [7.5, 25],
  ])('maps every DIVE frame at %s fps from a %s fps video back to one showing the same picture', (frameRate, originalFps) => {
    for (let frame = 0; frame < 300; frame += 1) {
      const time = presentedTime(frame, frameRate, originalFps);
      const found = videoTimeToFrame(time, frameRate, originalFps);
      // kwiverSeek's float rounding can land two DIVE frames on one video frame; either shows this picture.
      expect(presentedTime(found, frameRate, originalFps)).toBe(time);
      expect(videoTimeToFrame(time, frameRate, originalFps, frame)).toBe(frame);
    }
  });

  it('recovers the frame without a known video rate', () => {
    for (let frame = 0; frame < 300; frame += 1) {
      expect(videoTimeToFrame(presentedTime(frame, 30), 30)).toBe(frame);
    }
  });

  it('keeps the requested frame when several DIVE frames show the same video frame', () => {
    const time = presentedTime(7, 60, 30);
    expect(videoTimeToFrame(time, 60, 30, 7)).toBe(7);
    expect(videoTimeToFrame(time, 60, 30, 6)).toBe(6);
  });

  it('does not keep a requested frame the video is not showing', () => {
    expect(videoTimeToFrame(presentedTime(4, 10, 30), 10, 30, 9)).toBe(4);
  });
});
