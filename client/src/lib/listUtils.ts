/**
 * Binary search in JavaScript.
 * Adapted from https://stackoverflow.com/questions/22697936/binary-search-in-javascript
 * Returns the index of of the element in a sorted array or (-n-1) where n is the
 * insertion point for the new element.
 * The array may contain duplicate elements. If there are more than one equal
 * elements in the array, the returned value can be the index of any one of the equal elements.
 *
 * @param {Array<T>} arr A sorted array
 * @param {T} el element to search for
 * @param {Function} compareFn A comparator function. The function takes two arguments: (a, b)
 *                                              and returns:
 *                                              a negative number  if a is less than b;
 *                                              0 if a is equal to b;
 *                                              a positive number of a is greater than b.
 */
function binarySearch(
  arr: number[],
  el: number,
) {
  let m = 0;
  let n = arr.length - 1;
  while (m <= n) {
    // eslint-disable-next-line no-bitwise
    const k = (n + m) >> 1;
    const cmp = el - arr[k];
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

/**
 * Insert mutates arr.  Not to be used on reactive arrays.
 */
function listInsert(
  arr: number[],
  newval: number,
): number {
  const position = binarySearch(arr, newval);
  if (position >= 0) {
    // item at newval poisition already exists.
    // eslint-disable-next-line no-param-reassign
    arr[position] = newval;
    return position;
  }
  const newpos = (position * -1) - 1;
  arr.splice(newpos, 0, newval);
  return newpos;
}

/**
 * Remove mutates arr;
 */
function listRemove(
  arr: number[],
  val: number,
): number | null {
  const position = binarySearch(arr, val);
  if (position >= 0) {
    const deleted = arr.splice(position, 1);
    return deleted ? deleted[0] : null;
  }
  return null;
}

/**
 * Return bounding elements for position
 * such that return[0] <= position and return[1] > position
 */
function getSurroundingElements(
  arr: number[],
  position: number,
): [number, number] | null {
  let starti = position;
  // value not in list, binarySearch returned insert position
  if (starti < 0) {
    starti = Math.abs((starti + 1) * -1); // Nddeeded because `-0` is a thing in JS.
  }
  if (starti <= 0 || starti >= arr.length) {
    return null;
  }
  return [arr[starti - 1], arr[starti]];
}

export {
  binarySearch,
  getSurroundingElements,
  listInsert,
  listRemove,
};
