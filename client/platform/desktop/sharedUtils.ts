/**
 * utilities shared between renderer and main threads.
 */
import globToRegexp from 'glob-to-regexp';

function cleanString(dirty: string) {
  return dirty.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
function makeid(length: number): string {
  let result = '';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function filterByGlob(pattern: string, files: string[] = []) {
  const patterns = pattern.split(';').map((p) => globToRegexp(p, { flags: 'i' }));
  return files.filter((val) => patterns.some((re) => re.test(val)));
}

/* Zip arrays of unequal length */
function zip<T>(a: T[], b: T[]) {
  return Array.from(Array(Math.max(b.length, a.length)), (_, i) => [a[i], b[i]]);
}

/* Same as python version */
function strChunks(input: string) {
  return Array.from(input.split(/(\d+)/g))
    .filter((v) => v !== '')
    .map((v) => {
      const asInt = parseInt(v, 10);
      return Number.isNaN(asInt) ? v : asInt;
    });
}

/* same as python version */
function strNumericCompare(input1: string, input2: string) {
  if (input1 === input2) {
    return 0;
  }
  const zipped = zip(
    strChunks(input1),
    strChunks(input2),
  );
  for (
    let i = 0, [a, b] = zipped[0];
    i < zipped.length;
    i += 1, [a, b] = zipped[i]
  ) {
    if (a !== b) {
      if (a === undefined) return -1;
      if (b === undefined) return 1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      if (typeof a === 'number') return -1;
      if (typeof b === 'number') return 1;
      return input1 > input2 ? 1 : -1;
    }
  }
  throw new Error('Unreachable');
}

interface FrameTimestampPattern {
  name: string;
  regex: RegExp;
  toSeconds: (match: RegExpMatchArray) => number | undefined;
}

/* Roughly year 2000 to year 2100, used to reject implausible epoch guesses */
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
 * PROVISIONAL (SEAL feature 5, Phase I): parses a frame timestamp from a filename
 * using a small ordered list of guessed conventions. No real MML sample filenames
 * exist yet; replace/extend this list once real naming conventions are known.
 * Each entry is tried in order against the extension-stripped filename stem; the
 * first regex that matches AND passes its own plausibility check wins.
 */
const FRAME_TIMESTAMP_PATTERNS: FrameTimestampPattern[] = [
  {
    // YYYYMMDD[_-]HHMMSS, optionally with a fractional-second suffix
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
 * Best-effort frame capture timestamp, in epoch seconds, parsed from a filename.
 * Returns undefined (never throws) when no known convention matches -- this is
 * the expected common case and callers must treat it as "no timestamp available".
 */
function parseFrameTimestamp(filename: string): number | undefined {
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

export {
  cleanString,
  filterByGlob,
  makeid,
  parseFrameTimestamp,
  strChunks,
  strNumericCompare,
};
