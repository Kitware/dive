// eslint-disable-next-line import/no-extraneous-dependencies
import csvparser from 'csv-parse';
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs-extra';
import { pipeline } from 'stream';

import { cloneDeep } from 'lodash';
import {
  TrackData, Feature, StringKeyObject, ConfidencePair,
} from 'vue-media-annotator/track';

function _rowInfo(row: string[]) {
  if (row.length < 9) {
    throw new Error('malformed row: too few columns');
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

function _createGeoJSONFeauture(
  feature: Feature, type: string, coords: number[], key = '',
) {
  const f = cloneDeep(feature);
  const geoFeature = {};
  if (!f.geometry) {
    f.geometry = { type: 'FeatureCollection', features: [] };
  }
  return f;
}

function _parseRow(row: string[]): {
  feature: Feature;
  attributes: StringKeyObject;
  trackAttributes: StringKeyObject;
  confidencePairs: ConfidencePair[];
} {
  const info = _rowInfo(row);
  const feature: Feature = {
    frame: info.frame,
    bounds: info.bounds,
    fishLength: info.fishLength || undefined,
  };
  return {
    feature,
    attributes: {},
    trackAttributes: {},
    confidencePairs: [],
  };
}

async function parse(input: fs.ReadStream): Promise<TrackData[]> {
  const parser = csvparser({
    delimiter: ',',
    // comment lines may not have the correct number of columns
    relaxColumnCount: true,
  });

  const dataMap: Record<string, TrackData> = {};
  const dataList: TrackData[] = [];

  return new Promise<TrackData[]>((resolve, reject) => {
    pipeline(input, parser, (err) => {
      reject(err);
    });
    parser.on('readable', () => {
      let record;
      // eslint-disable-next-line no-cond-assign
      while (record = parser.read()) {
        console.log(record);
      }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(dataList));
  });
}

async function parseFile(path: string): Promise<TrackData[]> {
  const stream = fs.createReadStream(path);
  return parse(stream);
}

function serialize(data: TrackData[]): string[] {
  return [];
}

export {
  parse,
  parseFile,
  serialize,
};
