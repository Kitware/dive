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

/**
 * Extract numeric value from string.
 * Ex: input = '1_text00...200'
 * returns 100200
 */
function strNumericKey(input: string) {
  const matches = Array.from(input.matchAll(/\d+/g));
  return matches.length
    ? parseInt(Array.from(matches).join(''), 10)
    : 0;
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
  const num1 = strNumericKey(input1);
  const num2 = strNumericKey(input2);
  if (num1 === num2) {
    return input1 > input2 ? 1 : -1;
  }
  return num1 - num2;
}

export {
  cleanString,
  filterByGlob,
  makeid,
  strNumericCompare,
  strNumericKey,
};
