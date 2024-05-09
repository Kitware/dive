/* eslint-disable max-len */
import { isArray } from 'lodash';
import { AnnotationId } from './BaseAnnotation';
import type Track from './track';

export type MatchOperator = '=' | '≠' | '>' | '<' | '>=' | '<=' | 'range' | 'in' | 'rangeFilter' | 'contains';

export type userDefinedVals = number | string | string[] | number[] | null | boolean;

export interface AttributeMatch {
    op: MatchOperator;
    val: userDefinedVals; //number, string, array of numbers or strings
    userDefined?: boolean; // means that the user can edit the value in a filter tool
    range?: number[];
}

export interface AttributeTrackFilter {
    name: string;
    typeFilter: string[]; // filter for track of specific types, will default to all
    type: 'track' | 'detection';
    attribute: string;
    filter: AttributeMatch;
    ignoreUndefined?: boolean;
    enabled: boolean;
    primaryDisplay?: boolean; // should this filter be displayed in the main interface
}

export const checkAttributes = (attributeMatch: AttributeMatch, attributeVal: userDefinedVals, userDefinedVal: userDefinedVals | undefined) => {
  const results: boolean[] = [];
  const checkVal = attributeMatch.userDefined ? userDefinedVal : attributeMatch.val;
  if (attributeVal !== undefined) {
    if (attributeMatch.op) {
      switch (attributeMatch.op) {
        case '=': {
          // eslint-disable-next-line eqeqeq
          results.push(attributeVal == checkVal);
          break;
        }
        case '≠': {
          // eslint-disable-next-line eqeqeq
          results.push(attributeVal != checkVal);
          break;
        }
        case '>': {
          if (['number', 'string'].includes(typeof checkVal) && checkVal !== null && checkVal !== undefined) {
            results.push(attributeVal as number | string > checkVal);
          }
          break;
        }
        case '<': {
          if (['number', 'string'].includes(typeof checkVal) && checkVal !== null && checkVal !== undefined) {
            results.push(attributeVal as number | string < checkVal);
          }
          break;
        }
        case '<=': {
          if (['number', 'string'].includes(typeof checkVal) && checkVal !== null && checkVal !== undefined) {
            results.push(attributeVal as number | string <= checkVal);
          }
          break;
        }
        case '>=': {
          if (['number', 'string'].includes(typeof checkVal) && checkVal !== null && checkVal !== undefined) {
            results.push(attributeVal as number | string >= checkVal);
          }
          break;
        }
        case 'rangeFilter': {
          if (['number'].includes(typeof checkVal) && checkVal !== null && checkVal !== undefined) {
            results.push(attributeVal as number | string > checkVal);
          }
          break;
        }
        case 'range': {
          if (isArray(checkVal) && checkVal !== null && checkVal !== undefined) {
            if (checkVal[0] !== null && checkVal[1] !== null) {
              results.push(attributeVal as number | string >= checkVal[0] && attributeVal as number | string <= checkVal[1]);
            }
          }
          break;
        }
        case 'contains': {
          if (checkVal !== null && attributeVal !== null && checkVal !== undefined) {
            results.push(attributeVal?.toString().includes(checkVal.toString()));
          }
          break;
        }
        case 'in': {
          if (isArray(checkVal) && checkVal !== null && checkVal !== undefined && attributeVal !== null) {
            if (typeof checkVal[0] === 'number') {
              results.push((checkVal as number[]).includes(attributeVal as number));
            }
            if (typeof checkVal[0] === 'string') {
              results.push((checkVal as string[]).includes(attributeVal as string));
            }
          }
          break;
        }
        default: {
          results.push(attributeVal !== undefined);
        }
      }
    }
  } else {
    results.push(false);
  }
  return results.filter((item) => item).length === results.length;
};

export const trackIdPassesFilter = (
  id: AnnotationId,
  getTrack: (trackId: AnnotationId) => Track,
  filters: AttributeTrackFilter[],
  userDefinedvals: userDefinedVals[],
  enabled: boolean[],
) => {
  const track = getTrack(id);
  const trackAttributes = track.attributes;
  const trackFilters: AttributeTrackFilter[] = [];
  const detectionFilters: AttributeTrackFilter[] = [];
  const trackUserVals: userDefinedVals[] = [];
  const detectionUserVals: userDefinedVals[] = [];
  filters.forEach((item, index) => {
    if (enabled[index]) {
      if (item.type === 'track') {
        trackFilters.push(item);
        trackUserVals.push(userDefinedvals[index]);
      } else if (item.type === 'detection') {
        detectionFilters.push(item);
        detectionUserVals.push(userDefinedvals[index]);
      }
    }
  });
  for (let i = 0; i < trackFilters.length; i += 1) {
    const filter = trackFilters[i];
    // If we have a type filter only filter by the types specified
    if (filter.typeFilter.length > 0 && !filter.typeFilter.includes(track.getType()[0])) {
      return true;
    }
    if (trackAttributes[filter.attribute] === undefined && !filter.ignoreUndefined) {
      return false;
    }
    const result = checkAttributes(filter.filter, trackAttributes[filter.attribute] as userDefinedVals, trackUserVals[i]);
    if (!result) {
      return false;
    }
  }
  for (let i = 0; i < detectionFilters.length; i += 1) {
    for (let k = 0; k < track.featureIndex.length; k += 1) {
      const index = track.featureIndex[k];
      const detectionAttributes = track.features[index].attributes;
      const filter = detectionFilters[i];
      if (detectionAttributes) {
        if (detectionAttributes[filter.attribute] === undefined && !filter.ignoreUndefined) {
          return false;
        }
        const result = checkAttributes(filter.filter, detectionAttributes[filter.attribute] as userDefinedVals, detectionUserVals[i]);
        if (!result) {
          return false;
        }
      }
    }
  }
  return true;
};
