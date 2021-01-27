import { Attributes } from 'platform/desktop/constants';
import { Attribute, MultiTrackRecord } from 'viame-web-common/apispec';
import { StringKeyObject, TrackData } from 'vue-media-annotator/track';

type ProcessedAttribute = Record<string, Attribute & { testVals: Record<string, number>}>;

function processTrackAttributes(tracks: TrackData[]):
{data: MultiTrackRecord; attributes: Attributes} {
  const attributeObj: ProcessedAttribute = {};

  function processAttributes(attributes: StringKeyObject, type: 'track' | 'detection') {
    Object.entries(attributes).forEach(([key, val]) => {
      const valstring = `${val}`;
      if (attributeObj[`${type}_${key}`] === undefined) {
      // eslint-disable-next-line no-param-reassign
        attributeObj[`${type}_${key}`] = {
          belongs: type,
          datatype: 'text',
          name: key,
          _id: `${type}_${key}`,
          testVals: { },
        };
        // eslint-disable-next-line no-param-reassign
        attributeObj[`${type}_${key}`].testVals[valstring] = 1;
      } else if (attributeObj[`${type}_${key}`] && attributeObj[`${type}_${key}`].testVals) {
        if (attributeObj[`${type}_${key}`].testVals[valstring]) {
        // eslint-disable-next-line no-param-reassign
          attributeObj[`${type}_${key}`].testVals[valstring] += 1;
        }
      }
    });
    //Now we attempt to process the attributes for the type.
    Object.values(attributeObj).forEach((attribute) => {
      if (attribute.testVals) {
        let attributeType: ('number' | 'boolean' | 'text') = 'number';
        let lowCount = 1;
        const values: string[] = [];
        Object.entries(attribute.testVals).forEach(([key, val]) => {
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
        //If all items are used 2 or more times it has set Values otherwise it doesn't
        if (lowCount >= 2 && attributeType.indexOf('text') !== -1) {
        // eslint-disable-next-line no-param-reassign
          attribute.values = values;
        }
        // eslint-disable-next-line no-param-reassign
        attribute.datatype = attributeType;
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
          processAttributes(track.attributes, 'detection');
        }
      });
    }
  }

  const trackMap: MultiTrackRecord = {};
  tracks.forEach((t) => {
    trackMap[t.trackId.toString()] = t;
    // Gather track & detection attributes in file
    processTrackforAttributes(t);
  });
  return { data: trackMap, attributes: attributeObj };
}

export default processTrackAttributes;
