import { ref, Ref } from '@vue/composition-api';

import Track from 'vue-media-annotator/track';
import Recipe, { UpdateResponse } from 'vue-media-annotator/recipe';

export const HeadTailLineKey = 'HeadTails';
export const HeadPointKey = 'head';
export const TailPointKey = 'tail';
const EmptyResponse: UpdateResponse = { data: {}, union: [], unionWithoutBounds: [] };

export default class HeadTail implements Recipe {
  active: Ref<boolean>;

  name: string;

  constructor() {
    this.active = ref(false);

    this.name = 'HeadTail';
  }

  static findBounds(ls: GeoJSON.LineString): GeoJSON.Polygon[] {
    return [{
      type: 'Polygon',
      coordinates: [ls.coordinates],
    }];
  }

  static remove(frameNum: number, track: Track, index: number) {
    track.removeFeatureGeometry(frameNum, {
      key: HeadTailLineKey,
      type: 'LineString',
    });
    if (index === -1 || index === 0) {
      track.removeFeatureGeometry(frameNum, {
        key: HeadPointKey,
        type: 'Point',
      });
    }
    if (index === -1 || index === 1) {
      track.removeFeatureGeometry(frameNum, {
        key: TailPointKey,
        type: 'Point',
      });
    }
  }

  static makeGeom(ls: GeoJSON.LineString) {
    const headFeature: GeoJSON.Feature<GeoJSON.Point> = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          ls.coordinates[0][0],
          ls.coordinates[0][1],
        ],
      },
      properties: {},
    };
    const ret: Record<string, GeoJSON.Feature<GeoJSON.Point|GeoJSON.LineString>[]> = {
      [HeadPointKey]: [headFeature],
    };
    if (ls.coordinates.length === 2) {
      const tailFeature: GeoJSON.Feature<GeoJSON.Point> = {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            ls.coordinates[1][0],
            ls.coordinates[1][1],
          ],
        },
        properties: {},
      };
      const headTailLine: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        geometry: ls,
        properties: {},
      };
      ret[TailPointKey] = [tailFeature];
      ret[HeadTailLineKey] = [headTailLine];
    }
    return ret;
  }

  update(
    mode: 'in-progress' | 'editing',
    frameNum: number,
    track: Track,
    data: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point>[],
    key?: string,
  ) {
    const linestrings = data.filter((d) => d.geometry.type === 'LineString');
    if (linestrings.length) {
      const linestring = linestrings[0] as GeoJSON.Feature<GeoJSON.LineString>;
      if (this.active.value && mode === 'in-progress') {
      /**
       * IF the recipe is active, we are creating a new headtail
       */
        const geom = linestring.geometry;
        if (geom.coordinates.length === 2) {
          // Both head and tail placed, replace them.
          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(geom),
            newSelectedKey: HeadTailLineKey,
            newType: 'LineString',
            union: HeadTail.findBounds(geom),
          } as UpdateResponse;
        }
        if (geom.coordinates.length === 1) {
          // Only the head placed so far
          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(geom),
          };
        }
      }
      if (key === HeadTailLineKey && mode === 'editing') {
      /**
       * IF recipe isn't active, but the key matches, we are editing
       */
        return {
          ...EmptyResponse,
          data: HeadTail.makeGeom(linestring.geometry),
          union: HeadTail.findBounds(linestring.geometry),
        };
      }
    }
    return EmptyResponse;
  }

  activate() {
    this.active.value = true;
  }
}
