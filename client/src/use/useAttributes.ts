
import {
  ref, Ref, computed, set as VueSet, del as VueDel,
} from '@vue/composition-api';
import { features } from 'process';
import { StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import { Track } from '..';

export interface Attribute {
  belongs: 'track' | 'detection';
  datatype: 'text' | 'number' | 'boolean';
  values?: string[];
  name: string;
  key: string;
}

export type Attributes = Record<string, Attribute>;
type ValueOf<T> = T[keyof T];

export interface AttributeNumberFilter {
  type: 'range' | 'top'; // range filters for number values, top will show highest X values
  comp: '>' | '<' | '>=' | '<=';
  value: number; //current value
  active: boolean; // if this filter is active
  // Settings for Number Fitler
  range: [number, number]; // Pairs of number indicating start/stop ranges
  appliedTo: string[];
}

export interface AttributeStringFilter {
  comp: '=' | '!=' | 'contains' | 'starts';
  value: string[]; //Compares with array of items
  appliedTo: string[];
  active: boolean; // if this filter is active
}

export interface AttributeKeyFilter {
  appliedTo: string[];
  active: boolean; // if this filter is active
  value: true;
  type: 'key';
}
export interface AttributeBoolFilter {
  value: boolean;
  type: 'is' | 'not';
  appliedTo: string[];
  active: boolean; // if this filter is active
}
export interface AttributeFilter {
  dataType: Attribute['datatype'] | 'key';
  filterData:
  AttributeNumberFilter
  | AttributeStringFilter
  | AttributeBoolFilter
  | AttributeKeyFilter;
}
/**
 * Modified markChangesPending for attributes specifically
 */
interface UseAttributesParams {
  markChangesPending: (
    {
      action,
      attribute,
    }: {
      action: 'upsert' | 'delete';
      attribute: Attribute;
    }
  ) => void;
}

export default function UseAttributes({ markChangesPending }: UseAttributesParams) {
  const attributes: Ref<Record<string, Attribute>> = ref({});
  const attributeFilters: Ref<{
    track: AttributeFilter[];
    detection: AttributeFilter[];
  }> = ref({ track: [], detection: [] });


  function loadAttributes(metadataAttributes: Record<string, Attribute>) {
    attributes.value = metadataAttributes;
  }

  const attributesList = computed(() => Object.values(attributes.value));

  function setAttribute({ data, oldAttribute }:
     {data: Attribute; oldAttribute?: Attribute }, updateAllTracks = false) {
    if (oldAttribute && data.key !== oldAttribute.key) {
      // Name change should delete the old attribute and create a new one with the updated id
      VueDel(attributes.value, oldAttribute.key);
      markChangesPending({ action: 'delete', attribute: oldAttribute });
      // Create a new attribute to replace it
    }
    if (updateAllTracks && oldAttribute) {
      // TODO: Lengthy track/detection attribute updating function
    }
    VueSet(attributes.value, data.key, data);
    markChangesPending({ action: 'upsert', attribute: attributes.value[data.key] });
  }


  function deleteAttribute({ data }: {data: Attribute}, removeFromTracks = false) {
    if (attributes.value[data.key] !== undefined) {
      markChangesPending({ action: 'delete', attribute: attributes.value[data.key] });
      VueDel(attributes.value, data.key);
    }
    if (removeFromTracks) {
      // TODO: Lengthty track/detection attribute deletion function
    }
  }

  function addAttributeFilter(index: number, type: Attribute['belongs'], filter: AttributeFilter) {
    const filterList = attributeFilters.value[type];
    filterList.push(filter);
    VueSet(attributeFilters.value, type, filterList);
  }

  function deleteAttributeFilter(index: number, type: Attribute['belongs']) {
    const filterList = attributeFilters.value[type];
    if (index < filterList.length) {
      filterList.splice(index, 1);
    } else {
      throw Error(`Index: ${index} is out of range for the ${type} filter list of length ${filterList.length}`);
    }
  }
  function modifyAttributeFilter(index: number, type: Attribute['belongs'], filter: AttributeFilter) {
    const filterList = attributeFilters.value[type];
    if (index < filterList.length) {
      filterList[index] = filter;
      VueSet(attributeFilters.value, type, filterList);
    } else {
      throw Error(`Index: ${index} is out of range for the ${type} filter list of length ${filterList.length}`);
    }
  }

  function sortAttributes(attributeList: Attribute[], mode: Attribute['belongs'], attribVals: StringKeyObject, sortingMode: number) {
    const filteredAttributes = Object.values(attributeList).filter(
      (attribute: Attribute) => attribute.belongs === mode,
    );
    return filteredAttributes.sort((a, b) => {
      if (sortingMode === 0) {
        return (a.key.toLowerCase().localeCompare(b.key.toLowerCase()));
      }
      const aVal = attribVals[a.name];
      const bVal = attribVals[b.name];
      if (aVal === undefined && bVal === undefined) {
        return 0;
      } if (aVal === undefined && bVal !== undefined) {
        return 1;
      } if (aVal !== undefined && bVal === undefined) {
        return -1;
      }
      if (a.datatype === 'number' && b.datatype === 'number') {
        return (bVal as number) - (aVal as number);
      } if (a.datatype === 'number' && b.datatype !== 'number') {
        return -1;
      }
      if (a.datatype !== 'number' && b.datatype === 'number') {
        return 1;
      }
      return (a.key.toLowerCase().localeCompare(b.key.toLowerCase()));
    });
  }

  function applyStringFilter(
    filter: AttributeStringFilter,
    item: Attribute,
    val: string,
  ) {
    if (filter.comp === '=') {
      return filter.value.includes(val);
    } if (filter.comp === '!=') {
      return !filter.value.includes(val);
    } if (filter.comp === 'contains') {
      return filter.value.reduce((prev, str) => prev || str.includes(val), false);
    } if (filter.comp === 'starts') {
      return filter.value.reduce((prev, str) => prev || str.startsWith(val), false);
    }
    return true;
  }
  function applyNumberFilter(
    filter: AttributeNumberFilter,
    item: Attribute,
    val: number,
    index: number,
  ) {
    if (filter.type === 'range') {
      if (filter.comp === '>') {
        return (val > filter.value);
      } if (filter.comp === '<') {
        return (val < filter.value);
      } if (filter.comp === '<=') {
        return (val <= filter.value);
      } if (filter.comp === '>=') {
        return (val >= filter.value);
      }
      return true;
    }
    if (filter.type === 'top') {
      return index < filter.value;
    }
    return true;
  }

  function applyKeyFilter(filter: AttributeKeyFilter,
    item: Attribute) {
    if (filter.appliedTo.includes(item.name) || filter.appliedTo.includes('all')) {
      return true;
    }
    return false;
  }

  function filterAttributes(attributeList: Attribute[], mode: Attribute['belongs'], attribVals: StringKeyObject, filters: AttributeFilter[]) {
    let sortedFilteredAttributes = attributeList;
    filters.forEach((filter) => {
      if (filter.filterData.active) {
        sortedFilteredAttributes = sortedFilteredAttributes.filter((item, index) => {
          // Filter on appliedTo list of attributes or 'all'
          if (filter.dataType !== 'key' && (filter.filterData.appliedTo.includes(item.name) || filter.filterData.appliedTo[0] === 'all')) {
            if (filter.dataType === 'number' && item.datatype === 'number') {
              const numberFilter = filter.filterData as AttributeNumberFilter;
              return applyNumberFilter(numberFilter, item, attribVals[item.name] as number, index);
            }
            if (filter.dataType === 'text' && item.datatype === 'text') {
              const stringFilter = filter.filterData as AttributeStringFilter;
              return applyStringFilter(stringFilter, item, attribVals[item.name] as string);
            }
            return true;
          } if (filter.dataType === 'key') {
            const keyFilter = filter.filterData as AttributeKeyFilter;
            return applyKeyFilter(keyFilter, item);
          }
          return true;
        });
      }
      return sortedFilteredAttributes;
    });
    return sortedFilteredAttributes;
  }

  /**
   * Used for display purposes of the Attributes in the sideBar. If you are rendering
   * Attributes for track  and want the filters applied it may be better to filter
   * only on existing values in AttribVals instead of the entire object This takes
   * the Attributes built in Sorts them by Name or Numeric value and then filters them
   * based on the filters that have are active.
   * @param attributeList list of tempalated attributes
   * @param mode - detection or tack
   * @param attribVals - the attribute values for the track/detection
   * @param sortingMode - 0 = alphabetical, 1 = numeric
   * @param filters - list of filters to applie
   * @returns - sorted list of attributes
   */
  function sortAndFilterAttributes(attributeList: Attribute[], mode: Attribute['belongs'], attribVals: StringKeyObject, sortingMode: number, filters: AttributeFilter[]) {
    const sortedAttributes = sortAttributes(attributeList, mode, attribVals, sortingMode);
    const filteredAttributes = filterAttributes(sortedAttributes, mode, attribVals, filters);
    return filteredAttributes;
  }

  function generateTimelineData(
    attributeList: Attribute[],
    track: Track,
    filter: AttributeKeyFilter,
  ) {
    // So we need to generate a list of all of the attributres for the length of the track
    const valueMap: Record<string, {frame: number; value: Attribute['datatype'] }[]> = { };
    track.features.forEach((feature) => {
      const { frame } = feature;
      if (feature.attributes) {
        Object.keys(feature.attributes).forEach((key) => {
          if (feature.attributes && filter.appliedTo.includes(key)) {
            const val = feature.attributes[key] as Attribute['datatype'];
            if (valueMap[key] === undefined) {
              valueMap[key] = [];
            }
            valueMap[key].push({
              frame,
              value: val,
            });
          }
        });
      }
    });
  }

  return {
    loadAttributes,
    attributesList,
    setAttribute,
    deleteAttribute,
    addAttributeFilter,
    deleteAttributeFilter,
    modifyAttributeFilter,
    attributeFilters,
    sortAndFilterAttributes,
  };
}
