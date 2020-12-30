/**
 * VIAME CSV parser/serializer copied logically from
 * viame_server.serializers.viame python module
 */

import csvparser from 'csv-parse';
import fs from 'fs-extra';
import { pipeline } from 'stream';

import {
  TrackData, Feature, StringKeyObject, ConfidencePair, TrackSupportedFeature,
} from 'vue-media-annotator/track';

const CommentRegex = /^\s*#/g;
const HeadRegex = /^\(kp\) head ([0-9]+\.*[0-9]*) ([0-9]+\.*[0-9]*)/g;
const TailRegex = /^\(kp\) tail ([0-9]+\.*[0-9]*) ([0-9]+\.*[0-9]*)/g;
const AttrRegex = /^\(atr\) (.*?)\s(.+)/g;
const TrackAttrRegex = /^\(trk-atr\) (.*?)\s(.+)/g;
const PolyRegex = /^(\(poly\)) ((?:[0-9]+\.*[0-9]*\s*)+)/g;

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/matchAll
function getCaptureGroups(regexp: RegExp, str: string) {
  const iterable = str.matchAll(regexp);
  const array = [];
  let v = iterable.next();
  while (!v.done) {
    array.push(v.value);
    v = iterable.next();
  }
  if (array.length) {
    return array[0];
  }
  return null;
}

function _rowInfo(row: string[]) {
  if (row.length < 9) {
    throw new Error('malformed row: too few columns');
  }
  if (row[0].match(CommentRegex) !== null) {
    throw new Error('malformed row: comment row');
  }
  return {
    trackId: parseInt(row[0], 10),
    filename: row[1],
    frame: parseInt(row[2], 10),
    bounds: (
      row.slice(3, 7).map((v) => Math.round(parseFloat(v))) as
      [number, number, number, number]
    ),
    fishLength: parseFloat(row[8]),
  };
}

function _deduceType(value: string): boolean | number | string {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const float = parseFloat(value);
  if (!Number.isNaN(float)) {
    return float;
  }
  return value;
}

/**
 * Simplified from python variant.  Does not handle duplicate type/key pairs
 * within a single feature.
 *
 * @param type geojson feature type
 * @param coords 2D float array
 * @param key optional feature key string
 */
function _createGeoJsonFeature(
  type: 'Point' | 'LineString' | 'Polygon',
  coords: number[][],
  key = '',
) {
  const geoFeature: GeoJSON.Feature<TrackSupportedFeature, GeoJSON.GeoJsonProperties> = {
    type: 'Feature',
    properties: { key },
    geometry: {
      type,
      coordinates: [],
    },
  };
  if (type === 'Polygon') {
    geoFeature.geometry.coordinates = [coords];
  } else if (type === 'Point') {
    [geoFeature.geometry.coordinates] = coords;
  } else {
    geoFeature.geometry.coordinates = coords;
  }
  return geoFeature;
}

function _parseRow(row: string[]) {
  // Create empty feature collection
  const geoFeatureCollection:
    GeoJSON.FeatureCollection<TrackSupportedFeature, GeoJSON.GeoJsonProperties> = {
      type: 'FeatureCollection',
      features: [],
    };
  let attributes: StringKeyObject | undefined;
  const trackAttributes: StringKeyObject = {};
  const cpStarti = 9; // Confidence pairs start at i=9
  const confidencePairs: ConfidencePair[] = row
    .slice(cpStarti, row.length)
    .map((_, j) => {
      if (j % 2 !== 0) {
        // Filter out ODDs
        return ['', 0] as ConfidencePair;
      }
      const i = j + cpStarti;
      if ((i + 1) < row.length && row[i] && row[i + 1] && !row[i].startsWith('(')) {
        return [row[i], parseFloat(row[i + 1])] as ConfidencePair;
      }
      return ['', 0] as ConfidencePair;
    })
    .filter((val) => val[0] !== '')
    .sort((a, b) => b[1] - a[1]);
  const headTail: [number, number][] = [];
  const start = 9 + (confidencePairs.length * 2);
  row.slice(start).forEach((value) => {
    /* Head */
    const head = getCaptureGroups(HeadRegex, value);
    if (head !== null) {
      headTail[0] = [parseFloat(head[1]), parseFloat(head[2])];
      geoFeatureCollection.features.push(_createGeoJsonFeature('Point', [headTail[0]], 'head'));
    }

    /* Tail */
    const tail = getCaptureGroups(TailRegex, value);
    if (tail !== null) {
      headTail[1] = [parseFloat(tail[1]), parseFloat(tail[2])];
      geoFeatureCollection.features.push(_createGeoJsonFeature('Point', [headTail[1]], 'tail'));
    }

    /* Detection Attribute */
    const attr = getCaptureGroups(AttrRegex, value);
    if (attr !== null) {
      if (attributes === undefined) attributes = {};
      attributes[attr[1]] = _deduceType(attr[2]);
    }

    /* Track Attribute */
    const trackattr = getCaptureGroups(TrackAttrRegex, value);
    if (trackattr !== null) {
      trackAttributes[trackattr[1]] = _deduceType(trackattr[2]);
    }

    /* Polygon */
    const poly = getCaptureGroups(PolyRegex, value);
    if (poly !== null) {
      const coords: number[][] = [];
      const polyList = poly[2].split(' ');
      polyList.forEach((coord, j) => {
        if (j % 2 === 0) {
          // Filter out ODDs
          if (polyList[j + 1]) {
            coords.push([parseFloat(coord), parseFloat(polyList[j + 1])]);
          }
        }
      });
      geoFeatureCollection.features.push(_createGeoJsonFeature('Polygon', coords));
    }
  });

  if (headTail[0] !== undefined && headTail[1] !== undefined) {
    geoFeatureCollection.features.push(_createGeoJsonFeature('LineString', headTail, 'HeadTails'));
  }

  return {
    attributes, trackAttributes, confidencePairs, geoFeatureCollection,
  };
}

function _parseFeature(row: string[]) {
  const rowInfo = _rowInfo(row);
  const rowData = _parseRow(row);
  const feature: Feature = {
    frame: rowInfo.frame,
    bounds: rowInfo.bounds,
    fishLength: rowInfo.fishLength,
  };
  if (rowData.attributes) {
    feature.attributes = rowData.attributes;
  }
  if (rowData.geoFeatureCollection.features.length > 0) {
    feature.geometry = rowData.geoFeatureCollection;
  }
  return {
    rowInfo,
    feature,
    trackAttributes: rowData.trackAttributes,
    confidencePairs: rowData.confidencePairs,
  };
}

async function parse(input: fs.ReadStream): Promise<TrackData[]> {
  const parser = csvparser({
    delimiter: ',',
    // comment lines may not have the correct number of columns
    relaxColumnCount: true,
  });

  const dataMap = new Map<number, TrackData>();

  return new Promise<TrackData[]>((resolve, reject) => {
    pipeline(input, parser, (err) => {
      // undefined err indicates successful exit
      if (err !== undefined) {
        reject(err);
      }
      resolve(Array.from(dataMap.values()));
    });
    parser.on('readable', () => {
      let record: string[];
      // eslint-disable-next-line no-cond-assign
      while (record = parser.read()) {
        try {
          const {
            rowInfo, feature, trackAttributes, confidencePairs,
          } = _parseFeature(record);
          let track = dataMap.get(rowInfo.trackId);
          if (track === undefined) {
            // Create new track if not exists in map
            track = {
              begin: rowInfo.frame,
              end: rowInfo.frame,
              trackId: rowInfo.trackId,
              meta: {},
              attributes: {},
              confidencePairs: [],
              features: [],
            };
            dataMap.set(rowInfo.trackId, track);
          }
          track.begin = Math.min(rowInfo.frame, track.begin);
          track.end = Math.max(rowInfo.frame, track.end);
          track.features.push(feature);
          track.confidencePairs = confidencePairs;
          Object.entries(trackAttributes).forEach(([key, val]) => {
            // "track is possibly undefined" seems like a bug
            // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
            // @ts-ignore
            track.attributes[key] = val;
          });
        } catch (err) {
          // Allow malformed row errors
          if (!err.toString().includes('malformed row')) {
            throw err;
          }
        }
      }
    });
    parser.on('error', (err) => {
      console.error(err);
      reject(err);
    });
  });
}

async function parseFile(path: string): Promise<TrackData[]> {
  const stream = fs.createReadStream(path);
  return parse(stream);
}

// function serialize(data: TrackData[]): string[] {
//   return [];
// }

export {
  parse,
  parseFile,
  // serialize,
};
