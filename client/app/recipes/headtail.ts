import { ref, Ref } from '@vue/composition-api';

import Track from 'vue-media-annotator/track';
import Recipe from 'vue-media-annotator/recipe';

export const HeadTailLineKey = 'HeadTails';
export const HeadPointKey = 'head';
export const TailPointKey = 'tail';

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
    frameNum: number,
    track: Track,
    data: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point>[],
    key?: string,
  ) {
    const linestrings = data.filter((d) => d.geometry.type === 'LineString');
    if (linestrings.length) {
      const linestring = linestrings[0] as GeoJSON.Feature<GeoJSON.LineString>;

      if (key === HeadTailLineKey) {
      /**
       * IF recipe isn't active, but the key matches, we are editing
       */
        return {
          data: HeadTail.makeGeom(linestring.geometry),
          union: HeadTail.findBounds(linestring.geometry),
          unionWithoutBounds: [],
        };
      }
      if (this.active.value) {
      /**
       * IF the recipe is active, we are creating a new headtail
       */
        if (linestring.geometry.coordinates.length === 2) {
          return {
            data: HeadTail.makeGeom(linestring.geometry),
            // TODO why is typescript losing its mind here.
            newMode: 'editing' as 'editing',
            newType: 'rectangle' as 'rectangle',
            newSelectedKey: HeadTailLineKey,
            union: HeadTail.findBounds(linestring.geometry),
            unionWithoutBounds: [],
          };
        }
      }
    }
    return { data: {}, union: [], unionWithoutBounds: [] };
  }

  abort(data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>) {
    this.active.value = false;
    // console.log('aborted', data);
    return {
      data: {},
      union: [],
      unionWithoutBounds: [],
    };
  }

  activate() {
    this.active.value = true;
  }
}
