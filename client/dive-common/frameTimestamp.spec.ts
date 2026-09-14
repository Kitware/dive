import type { FrameImage } from 'dive-common/apispec';
import { attachFrameTimestamps, parseFrameTimestamp } from 'dive-common/frameTimestamp';

describe('parseFrameTimestamp', () => {
  it('parses a YYYYMMDD_HHMMSS datestamp', () => {
    expect(parseFrameTimestamp('left_20230615_143022.png')).toBe(1686839422);
  });

  it('parses a real flight filename with microsecond precision', () => {
    // Confirmed convention from real sample data (data/test_data).
    expect(parseFrameTimestamp('calibration_fl02_C_20240407_130757.206341_ir.tif'))
      .toBeCloseTo(1712495277.206341, 6);
  });

  it('parses a datestamp with a fractional-second suffix', () => {
    expect(parseFrameTimestamp('left_20230615_143022.500.png')).toBe(1686839422.5);
  });

  it('parses a bare epoch-milliseconds filename', () => {
    expect(parseFrameTimestamp('img_1719843225123.tif')).toBeCloseTo(1719843225.123, 6);
  });

  it('parses a bare epoch-seconds filename', () => {
    expect(parseFrameTimestamp('img_1719843225.tif')).toBe(1719843225);
  });

  it('returns undefined for a plain sequential filename', () => {
    expect(parseFrameTimestamp('img_00001.png')).toBeUndefined();
  });

  it('returns undefined for a short frame-counter filename', () => {
    expect(parseFrameTimestamp('frame042.tif')).toBeUndefined();
  });

  it('returns undefined for an implausible-range digit run', () => {
    expect(parseFrameTimestamp('img_0000000001.png')).toBeUndefined();
  });

  it('is extension-agnostic (same stem, different extension)', () => {
    expect(parseFrameTimestamp('left_20230615_143022.tif'))
      .toBe(parseFrameTimestamp('left_20230615_143022.png'));
  });
});

describe('attachFrameTimestamps', () => {
  it('populates timestamp in place from each frame filename', () => {
    const frames: FrameImage[] = [
      { url: 'a', filename: 'left_20230615_143022.png' },
      { url: 'b', filename: 'img_00001.png' },
    ];
    attachFrameTimestamps(frames);
    expect(frames[0].timestamp).toBe(1686839422);
    expect(frames[1].timestamp).toBeUndefined();
  });
});
