import { AxiosError } from 'axios';
import { difference } from 'lodash';

/**
 * Binary search in JavaScript.
 * Adapted from https://stackoverflow.com/questions/22697936/binary-search-in-javascript
 * Returns the index of of the element in a sorted array or (-n-1) where n is the
 * insertion point for the new element.
 * The array may contain duplicate elements. If there are more than one equal
 * elements in the array, the returned value can be the index of any one of the equal elements.
 *
 * @param {Array} ar A sorted array
 * @param {any} an element to search for
 * @param {Function} compareFn A comparator function. The function takes two arguments: (a, b)
 *                                              and returns:
 *                                              a negative number  if a is less than b;
 *                                              0 if a is equal to b;
 *                                              a positive number of a is greater than b.
 */
function binarySearch<T>(
  ar: Array<T>,
  el: T,
  compareFn: (arg1: T, arg2: T) => number,
) {
  let m = 0;
  let n = ar.length - 1;
  while (m <= n) {
    // eslint-disable-next-line no-bitwise
    const k = (n + m) >> 1;
    const cmp = compareFn(el, ar[k]);
    if (cmp > 0) {
      m = k + 1;
    } else if (cmp < 0) {
      n = k - 1;
    } else {
      return k;
    }
  }
  return -m - 1;
}

function getResponseError(error: AxiosError): string | AxiosError {
  const { response } = error;
  return response?.data?.message || error;
}

/*
 * updateSubset keeps a subset up to date when its superset
 * changes.  Takes the old and new array values of the superset,
 * removes and adds changed values.  If a value is in both old and new superset
 * and omitted from subset, it will remain omitted.  If old and new are
 * the same, it will return null
 */
function updateSubset<T>(
  oldsuper: Readonly<T[]>,
  newsuper: Readonly<T[]>,
  subarr: Readonly<T[]>
): T[] | null {
  const addedValues = difference(newsuper, oldsuper);
  const removedValues = difference(oldsuper, newsuper);
  if (!addedValues.length && !removedValues.length) {
    return null;
  }
  const subset = new Set(subarr);
  addedValues.forEach((v) => subset.add(v));
  removedValues.forEach((v) => subset.delete(v));
  return Array.from(subset);
}

export {
  binarySearch,
  getResponseError,
  updateSubset,
};
