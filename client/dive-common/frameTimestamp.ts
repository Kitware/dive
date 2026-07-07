import type { FrameImage } from 'dive-common/apispec';

/**
 * Single source of truth for parsing a frame's capture timestamp out of its
 * filename (SEAL feature 5). Used by both platforms -- the desktop backend
 * (platform/desktop/backend/native) when enumerating local media, and the
 * web-girder API layer (platform/web-girder/api) after fetching media from
 * girder -- so there is exactly one implementation to maintain.
 */

interface FrameTimestampPattern {
  name: string;
  regex: RegExp;
  toSeconds: (match: RegExpMatchArray) => number | undefined;
}

/* Roughly year 2000 to year 2100, used to reject implausible epoch candidates */
function isPlausibleEpochSeconds(seconds: number): boolean {
  return seconds >= 946684800 && seconds <= 4102444800;
}

function dateStampToSeconds(match: RegExpMatchArray): number | undefined {
  const [, y, mo, d, h, mi, s, frac] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const millis = Date.UTC(year, month - 1, day, hour, minute, second);
  const fracSeconds = frac ? Number(`0.${frac}`) : 0;
  return millis / 1000 + fracSeconds;
}

/*
 * Parses a frame timestamp from a filename using a small ordered list of
 * conventions. The primary convention is KAMERA's, confirmed against sample
 * data (see the datestamp entry); the epoch-based patterns are fallbacks for
 * other capture systems. Each entry is tried in order against the
 * extension-stripped filename stem; the first regex that matches AND passes its
 * own plausibility check wins.
 */
const FRAME_TIMESTAMP_PATTERNS: FrameTimestampPattern[] = [
  {
    // KAMERA convention: YYYYMMDD[_-]HHMMSS with an optional fractional-second
    // suffix, e.g. kamera_calibration_fl02_C_20240407_130757.206341_ir.tif
    name: 'datestamp',
    regex: /(?<!\d)(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?:[.,](\d{1,6}))?(?!\d)/,
    toSeconds: dateStampToSeconds,
  },
  {
    // bare epoch milliseconds, e.g. img_1719843225123.tif
    name: 'epoch-millis',
    regex: /(?<!\d)(\d{13})(?!\d)/,
    toSeconds: (match) => {
      const seconds = Number(match[1]) / 1000;
      return isPlausibleEpochSeconds(seconds) ? seconds : undefined;
    },
  },
  {
    // bare epoch seconds, e.g. img_1719843225.tif
    name: 'epoch-seconds',
    regex: /(?<!\d)(\d{10})(?!\d)/,
    toSeconds: (match) => {
      const seconds = Number(match[1]);
      return isPlausibleEpochSeconds(seconds) ? seconds : undefined;
    },
  },
];

/**
 * Frame capture timestamp, in epoch seconds, parsed from a filename. Returns
 * undefined (never throws) when no recognized convention matches; callers must
 * treat that as "no timestamp available".
 */
export function parseFrameTimestamp(filename: string): number | undefined {
  const stem = filename.replace(/\.[^./\\]+$/, '');
  for (let i = 0; i < FRAME_TIMESTAMP_PATTERNS.length; i += 1) {
    const { regex, toSeconds } = FRAME_TIMESTAMP_PATTERNS[i];
    const match = stem.match(regex);
    if (match) {
      const seconds = toSeconds(match);
      if (seconds !== undefined) {
        return seconds;
      }
    }
  }
  return undefined;
}

/**
 * Populates `timestamp` on each frame in place from its filename. Convenience
 * for the web-girder API layer, which receives frames without timestamps and
 * parses them client-side (the girder server no longer does this).
 */
export function attachFrameTimestamps(frames: FrameImage[]): void {
  frames.forEach((frame) => {
    // eslint-disable-next-line no-param-reassign
    frame.timestamp = parseFrameTimestamp(frame.filename);
  });
}
