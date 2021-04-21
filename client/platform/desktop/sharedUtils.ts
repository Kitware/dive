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

function filterByGlob(pattern: string, files: string[]) {
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

export {
  cleanString,
  filterByGlob,
  makeid,
  strChunks,
  strNumericCompare,
};
