import { AxiosError } from 'axios';
import { difference } from 'lodash';

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
  subarr: Readonly<T[]>,
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
  getResponseError,
  updateSubset,
};
