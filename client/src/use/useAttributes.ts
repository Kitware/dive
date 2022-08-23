
import {
  ref, Ref, computed, set as VueSet, del as VueDel,
} from '@vue/composition-api';
import { StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import { StyleManager, Track } from '..';
import CameraStore from '../CameraStore';
import { LineChartData } from './useLineChart';

export interface NumericAttributeEditorOptions {
  type: 'combo'| 'slider';
  range?: number[];
  steps?: number;
}
export interface StringAttributeEditorOptions {
  type: 'locked'| 'freeform';
}

export interface Attribute {
  belongs: 'track' | 'detection';
  datatype: 'text' | 'number' | 'boolean';
  values?: string[];
  name: string;
  key: string;
  color?: string;
  editor?: NumericAttributeEditorOptions | StringAttributeEditorOptions;
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
  value: boolean;
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

export interface TimelineAttribute {
  data: LineChartData;
  minFrame: number;
  maxFrame: number;
  minValue?: number;
  maxValue?: number;
  avgValue?: number;
  type: Attribute['datatype'];
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
  selectedTrackId: Ref<number | null>;
  trackStyleManager: StyleManager;
  cameraStore: CameraStore;
}

export default function UseAttributes(
  {
    markChangesPending,
    trackStyleManager,
    selectedTrackId,
    cameraStore,
  }: UseAttributesParams,
) {
  const attributes: Ref<Record<string, Attribute>> = ref({});
  const attributeFilters: Ref<{
    track: AttributeFilter[];
    detection: AttributeFilter[];
  }> = ref({ track: [], detection: [] });
  const timelineFilter: Ref<AttributeKeyFilter> = ref({
    appliedTo: ['all'],
    active: true, // if this filter is active
    value: true,
    type: 'key' as 'key',
  });
  const timelineEnabled: Ref<boolean> = ref(false);

  function loadAttributes(metadataAttributes: Record<string, Attribute>) {
    attributes.value = metadataAttributes;
    Object.values(attributes.value).forEach((attribute) => {
      if (attribute.color === undefined) {
        // eslint-disable-next-line no-param-reassign
        attribute.color = trackStyleManager.typeStyling.value.color(attribute.name);
      }
    });
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
    if (oldAttribute === undefined) {
      // eslint-disable-next-line no-param-reassign
      data.color = trackStyleManager.typeStyling.value.color(data.name);
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

  function generateDetectionTimelineData(
    track: Track,
    filter: AttributeKeyFilter,
  ) {
    // So we need to generate a list of all of the attributres for the length of the track
    const valueMap: Record<string, TimelineAttribute> = { };
    track.features.forEach((feature) => {
      const { frame } = feature;
      if (feature.attributes) {
        Object.keys(feature.attributes).forEach((key) => {
          if (feature.attributes && (filter.appliedTo.includes(key) || filter.appliedTo.includes('all'))) {
            const val = feature.attributes[key] as string | number | boolean | undefined;
            if (val === undefined) {
              return;
            }
            if (valueMap[key] === undefined) {
              let dataType: Attribute['datatype'] = 'text';
              const data: LineChartData = {
                values: [],
                name: key,
                color: attributes.value[`detection_${key}`].color || 'white',
              };

              if (typeof (val) === 'number') {
                dataType = 'number';
              } else if (typeof (val) === 'boolean') {
                dataType = 'boolean';
              }

              valueMap[key] = {
                data,
                maxFrame: -Infinity,
                minFrame: Infinity,
                type: dataType,

              };
            }
            if (valueMap[key].type === 'number') {
              valueMap[key].data.values.push([
                frame,
              val as number,
              ]);
            }
            if (valueMap[key].type === 'number') {
              if (valueMap[key].minValue === undefined || valueMap[key].maxValue === undefined) {
                valueMap[key].minValue = Infinity;
                valueMap[key].maxValue = -Infinity;
              }
              valueMap[key].minValue = Math.min(valueMap[key].minValue as number, val as number);
              valueMap[key].maxValue = Math.max(valueMap[key].maxValue as number, val as number);
            }
            valueMap[key].minFrame = Math.min(valueMap[key].minFrame, frame);
            valueMap[key].maxFrame = Math.max(valueMap[key].maxFrame, frame);
          }
        });
      }
    });
    return valueMap;
  }

  const attributeTimelineData = computed(() => {
    if (selectedTrackId.value !== null && timelineEnabled.value && timelineFilter.value !== null) {
      const selectedTrack = cameraStore.getAnyPossibleTrack(selectedTrackId.value);
      if (selectedTrack) {
        const timelineData = generateDetectionTimelineData(selectedTrack, timelineFilter.value);
        // Need to convert any Number types to Line Chart data;
        const numberVals = Object.values(timelineData).filter((item) => item.type === 'number');
        return numberVals;
      }
    }
    return [];
  });

  function setTimelineEnabled(val: boolean) {
    timelineEnabled.value = val;
  }

  function setTimelineFilter(val: AttributeKeyFilter) {
    timelineFilter.value = val;
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
    setTimelineEnabled,
    setTimelineFilter,
    attributeTimelineData,
    timelineFilter,
    timelineEnabled,
  };
}
