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

/**
 * Extract numeric value from string.
 * Ex: input = '1_text00...200'
 * returns 100200
 */
function strNumericKey(input: string) {
  return Array.from(input.matchAll(/\d+/g)).map((v) => parseInt(v.join(''), 10));
}

/**
 * Sort compare function where strings are sorted
 * first by the concatenated value of all numbers,
 * then, if the numbers are equal, by each character's
 * unicode value (default string sort)
 */
function strNumericCompare(input1: string, input2: string) {
  if (input1 === input2) {
    return 0;
  }
  const zipped = zip(
    strNumericKey(input1),
    strNumericKey(input2),
  );
  for (let i = 0; i < zipped.length; i += 1) {
    const [a, b] = zipped[i];
    if (a !== b) {
      if (a === undefined) return -1;
      if (b === undefined) return 1;
      return a - b;
    }
  }
  return input1 > input2 ? 1 : -1;
}

export {
  cleanString,
  filterByGlob,
  makeid,
  strNumericCompare,
  strNumericKey,
};
