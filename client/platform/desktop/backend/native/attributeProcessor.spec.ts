/* eslint-disable quote-props */
/* eslint-disable @typescript-eslint/camelcase */

import { MultiTrackRecord } from 'dive-common/apispec';
import { TrackData } from 'vue-media-annotator/track';
import type { Attribute } from 'vue-media-annotator/use/useAttributes';
import processTrackAttributes from './attributeProcessor';

interface AttributeTestGroup {
    inputTracks: TrackData[];
    outputTracks: MultiTrackRecord;
    outputAttributes: Record<string, Attribute>;
}

const genericTrackPair: AttributeTestGroup = {
  inputTracks: [
    {
      trackId: 0,
      attributes: {},
      meta: {},
      confidencePairs: [['typestring', 0.55]],
      features: [
        {
          frame: 0,
          bounds: [885, 510, 1220, 738],
          keyframe: true,
          interpolate: false,
        },
        {
          frame: 1,
          bounds: [111, 222, 3333, 444],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 0,
      end: 1,
    },
    {
      trackId: 1,
      attributes: {},
      meta: {},
      confidencePairs: [['type2', 1.0]],
      features: [
        {
          frame: 0,
          bounds: [747, 457, 1039, 633],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 0,
      end: 0,
    },
    {
      trackId: 2,
      attributes: {},
      meta: {},
      confidencePairs: [['type3', 0.765]],
      features: [
        {
          frame: 2,
          bounds: [10, 50, 20, 35],
          keyframe: true,
          interpolate: false,
          geometry: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { key: 'head' },
                geometry: {
                  type: 'Point',
                  coordinates: [22.4534, 45.6564],
                },
              },
              {
                type: 'Feature',
                properties: { key: 'tail' },
                geometry: {
                  type: 'Point',
                  coordinates: [55.232, 22.3445],
                },
              },
              {
                type: 'Feature',
                properties: { key: 'HeadTails' },
                geometry: {
                  coordinates: [
                    [22.4534, 45.6564],
                    [55.232, 22.3445],
                  ],
                  type: 'LineString',
                },
              },
            ],
          },
        },
        {
          frame: 3,
          bounds: [10, 50, 20, 35],
          keyframe: true,
          interpolate: false,
          geometry: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { key: 'head' },
                geometry: {
                  type: 'Point',
                  coordinates: [22.4534, 45.6564],
                },
              },
            ],
          },
        },
      ],
      begin: 2,
      end: 3,
    },
    {
      trackId: 3,
      attributes: {},
      meta: {},
      confidencePairs: [['type1', 0.89], ['type2', 0.65]],
      features: [
        {
          frame: 4,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 4,
      end: 4,
    },
    {
      trackId: 4,
      attributes: {},
      meta: {},
      confidencePairs: [['type1', 0.89], ['type2', 0.65]],
      features: [
        {
          frame: 5,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
          geometry: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { key: '' },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [1.0, 2.34],
                      [3.0, 4.0],
                      [5.0, 6.0],
                      [7.0, 8.08],
                      [9.0, 10.0],
                    ],
                  ],
                },
              },
            ],
          },
        },
      ],
      begin: 5,
      end: 5,
    },
    {
      trackId: 5,
      attributes: { booleanAttr: true },
      meta: {},
      confidencePairs: [['type1', 0.89]],
      features: [
        {
          frame: 6,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
          attributes: { attrNAME: 'spaced attr name' },
        },
      ],
      begin: 6,
      end: 6,
    },
    {
      trackId: 6,
      attributes: {},
      meta: {},
      confidencePairs: [['type1', 0.89], ['type2', 0.65], ['type3', 0.24]],
      features: [
        {
          frame: 4,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 4,
      end: 4,
    },
  ],
  outputTracks: {
    '0': {
      trackId: 0,
      attributes: {},
      meta: {},
      confidencePairs: [['typestring', 0.55]],
      features: [
        {
          frame: 0,
          bounds: [885, 510, 1220, 738],
          keyframe: true,
          interpolate: false,
        },
        {
          frame: 1,
          bounds: [111, 222, 3333, 444],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 0,
      end: 1,
    },
    '1': {
      trackId: 1,
      attributes: {},
      meta: {},
      confidencePairs: [['type2', 1.0]],
      features: [
        {
          frame: 0,
          bounds: [747, 457, 1039, 633],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 0,
      end: 0,
    },
    '2': {
      trackId: 2,
      attributes: {},
      meta: {},
      confidencePairs: [['type3', 0.765]],
      features: [
        {
          frame: 2,
          bounds: [10, 50, 20, 35],
          keyframe: true,
          interpolate: false,
          geometry: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { key: 'head' },
                geometry: {
                  type: 'Point',
                  coordinates: [22.4534, 45.6564],
                },
              },
              {
                type: 'Feature',
                properties: { key: 'tail' },
                geometry: {
                  type: 'Point',
                  coordinates: [55.232, 22.3445],
                },
              },
              {
                type: 'Feature',
                properties: { key: 'HeadTails' },
                geometry: {
                  coordinates: [
                    [22.4534, 45.6564],
                    [55.232, 22.3445],
                  ],
                  type: 'LineString',
                },
              },
            ],
          },
        },
        {
          frame: 3,
          bounds: [10, 50, 20, 35],
          keyframe: true,
          interpolate: false,
          geometry: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { key: 'head' },
                geometry: {
                  type: 'Point',
                  coordinates: [22.4534, 45.6564],
                },
              },
            ],
          },
        },
      ],
      begin: 2,
      end: 3,
    },
    '3': {
      trackId: 3,
      attributes: {},
      meta: {},
      confidencePairs: [['type1', 0.89], ['type2', 0.65]],
      features: [
        {
          frame: 4,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 4,
      end: 4,
    },
    '4': {
      trackId: 4,
      attributes: {},
      meta: {},
      confidencePairs: [['type1', 0.89], ['type2', 0.65]],
      features: [
        {
          frame: 5,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
          geometry: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { key: '' },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [1.0, 2.34],
                      [3.0, 4.0],
                      [5.0, 6.0],
                      [7.0, 8.08],
                      [9.0, 10.0],
                    ],
                  ],
                },
              },
            ],
          },
        },
      ],
      begin: 5,
      end: 5,
    },
    '5': {
      trackId: 5,
      attributes: { booleanAttr: true },
      meta: {},
      confidencePairs: [['type1', 0.89]],
      features: [
        {
          frame: 6,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
          attributes: { attrNAME: 'spaced attr name' },
        },
      ],
      begin: 6,
      end: 6,
    },
    '6': {
      trackId: 6,
      attributes: {},
      meta: {},
      confidencePairs: [['type1', 0.89], ['type2', 0.65], ['type3', 0.24]],
      features: [
        {
          frame: 4,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: false,
        },
      ],
      begin: 4,
      end: 4,
    },
  },
  outputAttributes: {
    detection_attrNAME: {
      belongs: 'detection',
      datatype: 'text',
      key: 'detection_attrNAME',
      name: 'attrNAME',
    },
    track_booleanAttr: {
      belongs: 'track',
      datatype: 'boolean',
      key: 'track_booleanAttr',
      name: 'booleanAttr',
    },
  },
};

const complicatedAttributesTrack: AttributeTestGroup = {
  'inputTracks': [
    {
      'trackId': 0,
      'attributes': { 'booleanAttr': true },
      'meta': {},
      'confidencePairs': [['typestring', 1.0]],
      'features': [
        {
          'frame': 0,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
            'DetectionNumber': 2.002,
          },
        },
        {
          'frame': 1,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 2,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
        {
          'frame': 3,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
          },
        },
        {
          'frame': 4,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 5,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
      ],
      'begin': 0,
      'end': 5,
    },
    {
      'trackId': 1,
      'attributes': { 'booleanAttr': true },
      'meta': {},
      'confidencePairs': [['typestring', 1.0]],
      'features': [
        {
          'frame': 0,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
            'DetectionNumber': 2.002,
          },
        },
        {
          'frame': 1,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 2,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
        {
          'frame': 3,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
          },
        },
        {
          'frame': 4,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 5,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
      ],
      'begin': 0,
      'end': 5,
    },
  ],
  'outputTracks': {
    '0': {
      'trackId': 0,
      'attributes': { 'booleanAttr': true },
      'meta': {},
      'confidencePairs': [['typestring', 1.0]],
      'features': [
        {
          'frame': 0,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
            'DetectionNumber': 2.002,
          },
        },
        {
          'frame': 1,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 2,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
        {
          'frame': 3,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
          },
        },
        {
          'frame': 4,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 5,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
      ],
      'begin': 0,
      'end': 5,
    },
    '1': {
      'trackId': 1,
      'attributes': { 'booleanAttr': true },
      'meta': {},
      'confidencePairs': [['typestring', 1.0]],
      'features': [
        {
          'frame': 0,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
            'DetectionNumber': 2.002,
          },
        },
        {
          'frame': 1,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 2,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
        {
          'frame': 3,
          'bounds': [885, 510, 1220, 738],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value1',
          },
        },
        {
          'frame': 4,
          'bounds': [111, 222, 3333, 444],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value2',
          },
        },
        {
          'frame': 5,
          'bounds': [747, 457, 1039, 633],
          'keyframe': true,
          'interpolate': false,
          'attributes': {
            'DetectionPredefinedValue': 'value3',
          },
        },
      ],
      'begin': 0,
      'end': 5,
    },
  },
  'outputAttributes': {
    'detection_DetectionNumber': {
      'belongs': 'detection',
      'datatype': 'number',
      'key': 'detection_DetectionNumber',
      'name': 'DetectionNumber',
    },
    'detection_DetectionPredefinedValue': {
      'belongs': 'detection',
      'datatype': 'text',
      'key': 'detection_DetectionPredefinedValue',
      'name': 'DetectionPredefinedValue',
      'values': ['value1', 'value2', 'value3'],
    },
    'track_booleanAttr': {
      'belongs': 'track',
      'datatype': 'boolean',
      'key': 'track_booleanAttr',
      'name': 'booleanAttr',
    },
  },
};
describe('native.attributeProcessor', () => {
  it('generic track loading', () => {
    const output = processTrackAttributes(genericTrackPair.inputTracks);
    expect(output.attributes).toStrictEqual(genericTrackPair.outputAttributes);
    expect(output.data).toStrictEqual(genericTrackPair.outputTracks);
  });
  it('complicated attributes loading', () => {
    const output = processTrackAttributes(complicatedAttributesTrack.inputTracks);
    expect(output.attributes).toStrictEqual(complicatedAttributesTrack.outputAttributes);
    expect(output.data).toStrictEqual(complicatedAttributesTrack.outputTracks);
  });
});
