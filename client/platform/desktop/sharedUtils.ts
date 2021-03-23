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

export {
  cleanString,
  filterByGlob,
  makeid,
};
