/* eslint-disable max-len */
/**
 * VIAME CSV parser/serializer copied logically from
 * dive_utils.serializers.viame python module
 */

import csvparser from 'csv-parse';
import csvstringify from 'csv-stringify';
import fs from 'fs-extra';
import moment from 'moment';
import { cloneDeep, flattenDeep } from 'lodash';
import { pipeline, Readable, Writable } from 'stream';

import { AnnotationSchema, MultiGroupRecord, MultiTrackRecord } from 'dive-common/apispec';
import { JsonMeta } from 'platform/desktop/constants';
import { splitExt } from 'platform/desktop/backend/native/utils';
// Imports that involve actual code require relative imports because ts-node barely works
// https://github.com/TypeStrong/ts-node/issues/422
import Track, {
  TrackData, Feature, TrackSupportedFeature,
} from 'vue-media-annotator/track';
import { ConfidencePair, StringKeyObject } from 'vue-media-annotator/BaseAnnotation';

const CommentRegex = /^\s*#/g;
const HeadRegex = /^\(kp\) head (-?[0-9]+\.*-?[0-9]*) (-?[0-9]+\.*-?[0-9]*)/g;
const TailRegex = /^\(kp\) tail (-?[0-9]+\.*-?[0-9]*) (-?[0-9]+\.*-?[0-9]*)/g;
const AttrRegex = /^\(atr\) (.*?)\s(.+)/g;
const TrackAttrRegex = /^\(trk-atr\) (.*?)\s(.+)/g;
const PolyRegex = /^(\(poly\)) ((?:-?[0-9]+\.*-?[0-9]*\s*)+)/g;
const FpsRegex = /fps:\s*(\d+(\.\d+)?)/ig;
const AtrToken = '(atr)';
const TrackAtrToken = '(trk-atr)';
const PolyToken = '(poly)';
const KeypointToken = '(kp)';

export interface AnnotationFileData {
  tracks: MultiTrackRecord;
  groups: MultiGroupRecord;
  fps?: number;
}

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
  if (row[0].match(CommentRegex) !== null) {
    throw new Error('comment row');
  }
  if (row.length < 9) {
    throw new Error('malformed row: too few columns');
  }
  return {
    id: parseInt(row[0], 10),
    filename: row[1],
    frame: parseInt(row[2], 10),
    bounds: (
      row.slice(3, 7).map((v) => Math.round(parseFloat(v))) as
      [number, number, number, number]
    ),
    fishLength: parseFloat(row[8]),
  };
}

function parseCommentRow(row: string[]) {
  const fullrow = row.join(' ');
  const matches = getCaptureGroups(FpsRegex, fullrow);
  let fps: undefined | number;
  if (matches !== null && matches.length >= 2) {
    fps = Number.parseFloat(matches[1]);
  }
  return { fps };
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

  // ensure confidence pairs list is not empty
  if (confidencePairs.length === 0) {
    // extract Detection or Length Confidence field
    const confidence = parseFloat(row[7]) || 1.0;
    // add a dummy pair with a default type
    confidencePairs.push(['unknown', confidence] as ConfidencePair);
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
  };
  if (rowInfo.fishLength !== -1) {
    feature.fishLength = rowInfo.fishLength;
  }
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

async function parse(input: Readable, imageMap?: Map<string, number>): Promise<AnnotationFileData> {
  const parser = csvparser({
    delimiter: ',',
    // comment lines may not have the correct number of columns
    relaxColumnCount: true,
  });
  let fps: number | undefined;
  const dataMap = new Map<number, TrackData>();
  const missingImages: string[] = [];
  const foundImages: {image: string; frame: number; csvFrame: number}[] = [];
  let error: Error | undefined;
  let multiFrameTracks = false;

  return new Promise<AnnotationFileData>((resolve, reject) => {
    pipeline([input, parser], (err) => {
      // undefined err indicates successful exit
      if (err !== undefined) {
        reject(err);
      }

      // Do a secondary pass for if we are only visualizing a subset of sequences of images
      if (missingImages.length > 0 && imageMap !== undefined && foundImages.length) {
        if (error !== undefined) { // Most likely a reorder error so reset it
          error = undefined;
        }
        // We need to find the total number of images mapped and make sure they are continuous
        // Also need to create a mapping of old frame numbers to new numbers
        // Additionall a min/max frame is required to cap tracks and remove items outside the range
        let minFrame = Infinity;
        let maxFrame = -Infinity;
        const frameMapper: Record<number, number> = {};
        const filteredImages = foundImages.filter((item) => item.frame !== -1);
        for (let i = 0; i < filteredImages.length; i += 1) {
          if (filteredImages[i].frame === -1) {
            // eslint-disable-next-line no-continue
            continue;
          }
          const k = i + 1;
          if (k < filteredImages.length) {
            if (filteredImages[i].csvFrame + 1 !== filteredImages[k].csvFrame || filteredImages[i].frame + 1 !== filteredImages[k].frame) {
            // We have misaligned image sequences so we error out
              error = new Error(`A subsampling of images were used with the CSV but they were not sequential\n 
                ${filteredImages[i].csvFrame + 1} !== ${filteredImages[k].csvFrame} || ${filteredImages[i].frame + 1} !== ${filteredImages[k].frame}\n
                image1: ${filteredImages[i].image} image2: ${filteredImages[k].image} - these should be sequential in the CSV
              \n`);
            }
          }
          frameMapper[filteredImages[i].csvFrame] = i;
          minFrame = Math.min(minFrame, filteredImages[i].csvFrame);
          maxFrame = Math.max(maxFrame, filteredImages[i].csvFrame);
        }
        // Now we need to remap and filter tracks that are outside the frame range
        const newDataMap: Record<TrackData['id'], TrackData> = {};
        const trackList = Object.values(Object.fromEntries(dataMap));
        trackList.forEach((track) => {
          if ((track.end >= minFrame)
          || (track.begin <= maxFrame)) {
            // begin and end frames need to be remapped to the subsampled region
            let { begin } = track;
            let { end } = track;
            if (begin < minFrame || frameMapper[begin] === undefined) {
              begin = frameMapper[minFrame];
            } else {
              begin = frameMapper[begin];
            }
            if (end > maxFrame || frameMapper[end] === undefined) {
              end = frameMapper[maxFrame];
            } else {
              end = frameMapper[end];
            }
            const newTrack: TrackData = {
              begin,
              end,
              id: track.id,
              attributes: track.attributes,
              confidencePairs: track.confidencePairs,
              features: [],
            };
            track.features.forEach((feature) => {
              // if feature frame is within the range add and remap the frame to the new time
              if (feature.frame >= minFrame && feature.frame <= maxFrame) {
                const newFeature = cloneDeep(feature);
                newFeature.frame = frameMapper[newFeature.frame];
                newTrack.features.push(newFeature);
              }
            });
            if (newTrack.features.length) {
              // Only add the track if it has features
              newDataMap[newTrack.id] = newTrack;
            }
          }
        });
        // Clear the existing dataMap to add the updated data
        dataMap.clear();

        // Set the new data in the dataMap
        Object.values(newDataMap).forEach((track) => {
          dataMap.set(track.id, track);
        });
      } else if (missingImages.length === 0 && foundImages.length && multiFrameTracks) {
        foundImages.sort((a, b) => a.csvFrame - b.csvFrame); // Sort to frame
        for (let i = 0; i < foundImages.length; i += 1) {
          const k = i + 1;
          if (k < foundImages.length) {
            if (foundImages[i].csvFrame > foundImages[k].csvFrame || foundImages[i].frame > foundImages[k].frame) {
            // We have misaligned video sequences so we error out
              error = new Error('Images were provided in an unexpected order and dataset contains multi-frame tracks.');
            }
          }
        }
      }
      const tracks = Object.fromEntries(dataMap);

      if (error !== undefined) {
        reject(error);
      }
      resolve({ tracks, groups: {}, fps });
    });
    parser.on('readable', () => {
      let record: string[];
      // eslint-disable-next-line no-cond-assign
      while (record = parser.read()) {
        try {
          const {
            rowInfo, feature, trackAttributes, confidencePairs,
          } = _parseFeature(record);
          if (imageMap !== undefined) {
            const [imageName] = splitExt(rowInfo.filename);
            const expectedFrameNumber = imageMap.get(imageName);
            // Create a foundImage to map frames if a subset of images are used
            const foundImage = {
              image: imageName,
              frame: expectedFrameNumber !== undefined ? expectedFrameNumber : -1,
              csvFrame: rowInfo.frame,
            };
            const hasImageAlready = foundImages.find(
              (item) => (item.frame === foundImage.frame && item.image === foundImage.image),
            );
            if (foundImage.frame !== -1 && hasImageAlready === undefined) {
              foundImages.push(foundImage);
            }
            if (expectedFrameNumber === undefined) {
              missingImages.push(rowInfo.filename);
            }
          }

          let track = dataMap.get(rowInfo.id);
          if (track === undefined) {
            // Create new track if not exists in map
            track = {
              begin: rowInfo.frame,
              end: rowInfo.frame,
              id: rowInfo.id,
              attributes: {},
              confidencePairs: [],
              features: [],
            };
            dataMap.set(rowInfo.id, track);
          } else {
            multiFrameTracks = true;
            let maxFeatureFrame = -Infinity;
            track.features.forEach((subFeature) => {
              maxFeatureFrame = Math.max(maxFeatureFrame, subFeature.frame);
            });
            if (rowInfo.frame < maxFeatureFrame) {
            // trackId was already in dataMap, and frame is out of order
              error = new Error(
                'annotations were provided in an unexpected order and dataset contains multi-frame tracks',
              );
              // eslint-disable-next-line no-continue
              continue;
            }
          }
          track.begin = Math.min(rowInfo.frame, track.begin);
          track.end = Math.max(rowInfo.frame, track.end);
          track.features.push(feature);
          track.confidencePairs = confidencePairs;
          Object.entries(trackAttributes).forEach(([key, val]) => {
            // "track is possibly undefined" seems like a bug
            if (track && track.attributes) {
              track.attributes[key] = val;
            }
          });
        } catch (err) {
          if (!(err instanceof Error)) {
            error = new Error(`Caught unexpected error ${err}`);
            // eslint-disable-next-line no-continue
            continue;
          }
          if (err.toString().includes('comment row')) {
            // parse comment row
            fps = fps || parseCommentRow(record).fps;
          } else if (!err.toString().includes('malformed row')) {
            // Allow malformed row errors
            error = err;
            // eslint-disable-next-line no-continue
            continue;
          }
        }
      }
    });
  });
}

async function parseFile(path: string, imageMap?: Map<string, number>):
  Promise<AnnotationFileData> {
  const stream = fs.createReadStream(path);
  return parse(stream, imageMap);
}

async function writeHeader(writer: Writable, meta: JsonMeta) {
  writer.write([
    '# 1: Detection or Track-id',
    '2: Video or Image Identifier',
    '3: Unique Frame Identifier',
    '4-7: Img-bbox(TL_x',
    'TL_y',
    'BR_x',
    'BR_y)',
    '8: Detection or Length Confidence',
    '9: Target Length (0 or -1 if invalid)',
    '10-11+: Repeated Species',
    'Confidence Pairs or Attributes',
  ]);
  if (meta.fps) {
    writer.write([
      '# metadata',
      `fps: ${meta.fps}`,
      `exported_by: ${JSON.stringify('dive:typescript')}`,
      `exported_time: ${JSON.stringify((new Date()).toLocaleString())}`,
    ]);
  }
}

async function serialize(
  stream: Writable,
  data: AnnotationSchema,
  meta: JsonMeta,
  typeFilter = new Set<string>(),
  options = {
    excludeBelowThreshold: false,
    header: true,
  },
): Promise<void> {
  const stringify = csvstringify();
  return new Promise((resolve, reject) => {
    pipeline(stringify, stream, (err) => {
      // undefined err indicates successful exit
      if (err !== undefined) {
        reject(err);
      }
      resolve();
    });
    writeHeader(stringify, meta);
    Object.values(data.tracks).forEach((track) => {
      const filters = meta.confidenceFilters || {};
      /* Include only the pairs that exceed the threshold in CSV output */
      const confidencePairs = options.excludeBelowThreshold
        ? Track.exceedsThreshold(track.confidencePairs, filters)
        : track.confidencePairs;
      const filteredPairs = typeFilter.size > 0
        ? confidencePairs.filter((x) => typeFilter.has(x[0]))
        : confidencePairs;
      if (filteredPairs.length) {
        const sortedPairs = filteredPairs.sort((a, b) => b[1] - a[1]);
        track.features.forEach((keyframeFeature, index) => {
          const interpolatedFeatures = [keyframeFeature];

          /* If this is not the final keyframe and interpolation is enabled */
          if (keyframeFeature.interpolate && keyframeFeature.frame < track.end) {
            const nextFeature = track.features[index + 1];
            /* Interpolate all features (a, b) NOT INCLUDING a or b */
            for (let f = keyframeFeature.frame + 1; f < nextFeature.frame; f += 1) {
              const interpolated = Track.interpolate(f, keyframeFeature, nextFeature);
              if (interpolated === null) {
                throw new Error('null interpolated track should be impossible here');
              }
              interpolatedFeatures.push(interpolated);
            }
          }

          /* Iterate all features (real and interpolated) */
          interpolatedFeatures.forEach((feature) => {
            /* Column 2 is timestamp in video, image name in image sequence */
            let column2 = '';
            if (meta.type === 'image-sequence') {
              column2 = meta.originalImageFiles[feature.frame];
            } else if (meta.type === 'video') {
              column2 = moment.utc((feature.frame / meta.fps) * 1000).format('HH:mm:ss.SSSSSS');
            }

            const row = [
              track.id,
              column2,
              feature.frame,
              ...(feature.bounds as number[]),
              sortedPairs[0][1], // always take highest confidence to be track confidence
              feature.fishLength || -1,
              ...flattenDeep(sortedPairs),
            ];

            /* Feature Attributes */
            Object.entries(feature.attributes || {}).forEach(([key, val]) => {
              row.push(`${AtrToken} ${key} ${val}`);
            });

            /* Track Attributes */
            Object.entries(track.attributes).forEach(([key, val]) => {
              row.push(`${TrackAtrToken} ${key} ${val}`);
            });

            /* Geometry */
            if (feature.geometry && feature.geometry.type === 'FeatureCollection') {
              feature.geometry.features.forEach((geoJSONFeature) => {
                if (geoJSONFeature.geometry.type === 'Polygon') {
                  const coordinates = flattenDeep(geoJSONFeature.geometry.coordinates[0]);
                  row.push(`${PolyToken} ${coordinates.map(Math.round).join(' ')}`);
                } else if (geoJSONFeature.geometry.type === 'Point') {
                  if (geoJSONFeature.properties) {
                    const kpname = geoJSONFeature.properties.key;
                    const { coordinates } = geoJSONFeature.geometry;
                    row.push(
                      `${KeypointToken} ${kpname} ${coordinates.map(Math.round).join(' ')}`,
                    );
                  }
                }
                /* TODO support for multiple GeoJSON Objects of the same type */
              });
            }
            stringify.write(row);
          });
        });
      }
    });
    stringify.end();
  });
}

async function serializeFile(
  path: string,
  data: AnnotationSchema,
  meta: JsonMeta,
  typeFilter = new Set<string>(),
  options = {
    excludeBelowThreshold: false,
    header: true,
  },
) {
  const stream = fs.createWriteStream(path);
  await serialize(stream, data, meta, typeFilter, options);
  return path;
}

export {
  parse,
  parseFile,
  serialize,
  serializeFile,
};
