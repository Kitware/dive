import { MultiTrackRecord } from 'dive-common/apispec';
import { StringKeyObject, TrackData } from 'vue-media-annotator/track';
import { Attributes } from 'vue-media-annotator/use/useAttributes';


/**
 * Processes a list of tracks and returns a MultiTrackRecord and an attributes object to be used
 * @param tracks list of tracks to process for the attributes
 */
function processTrackAttributes(tracks: TrackData[]):
{data: MultiTrackRecord; attributes: Attributes} {
  const attributeObj: Attributes = {};
  const trackMap: MultiTrackRecord = {};
  const testVals: Record<string, Record<string, number>> = {};

  function processAttributes(attributes: StringKeyObject, type: 'track' | 'detection') {
    Object.entries(attributes).forEach(([key, val]) => {
      const valstring = `${val}`;
      if (attributeObj[`${type}_${key}`] === undefined) {
        attributeObj[`${type}_${key}`] = {
          belongs: type,
          datatype: 'text',
          name: key,
          key: `${type}_${key}`,
        };
        testVals[`${type}_${key}`] = { };
        testVals[`${type}_${key}`][valstring] = 1;
      } else if (attributeObj[`${type}_${key}`] && testVals[`${type}_${key}`]) {
        if (testVals[`${type}_${key}`][valstring]) {
          testVals[`${type}_${key}`][valstring] += 1;
        } else {
          testVals[`${type}_${key}`][valstring] = 1;
        }
      }
    });
    // Now we attempt to process the attributes to infer the type.
    // Cascading based on the attempting to convert and values

    const predefinedMinCount = 3; // count all keys must have a value to convert to predefined
    Object.keys(attributeObj).forEach((attributeKey) => {
      if (testVals[attributeKey]) {
        let attributeType: ('number' | 'boolean' | 'text') = 'number';
        let lowCount = predefinedMinCount;
        const values: string[] = [];
        Object.entries(testVals[attributeKey]).forEach(([key, val]) => {
          if (val <= lowCount) {
            lowCount = val;
          }
          values.push(key);
          if (attributeType === 'number' && Number.isNaN(parseFloat(key))) {
            attributeType = 'boolean';
          }
          if (attributeType === 'boolean' && key !== 'true' && key !== 'false') {
            attributeType = 'text';
          }
        });
        // If all items are used 3 or more times it has discrete set Values otherwise
        if (lowCount >= predefinedMinCount && attributeType.indexOf('text') !== -1) {
          attributeObj[attributeKey].values = values;
        }
        // eslint-disable-next-line no-param-reassign
        attributeObj[attributeKey].datatype = attributeType;
      }
    });
  }

  function processTrackforAttributes(track: TrackData) {
    if (track.attributes) {
      processAttributes(track.attributes, 'track');
    }
    if (track.features) {
      track.features.forEach((item) => {
        if (item.attributes) {
          processAttributes(item.attributes, 'detection');
        }
      });
    }
  }

  tracks.forEach((t) => {
    if (t.trackId === undefined) {
      throw new Error('The Track JSON file contains no valid trackIds.');
    }
    trackMap[t.trackId.toString()] = t;
    processTrackforAttributes(t);
  });

  return { data: trackMap, attributes: attributeObj };
}

export default processTrackAttributes;
