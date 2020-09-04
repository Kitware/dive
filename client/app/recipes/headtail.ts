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

  static remove(frameNum: number, track: Track, index: number) {
    track.removeFeatureGeometry(frameNum, {
      key: 'HeadTails',
      type: 'LineString',
    });
    if (index === -1 || index === 0) {
      track.removeFeatureGeometry(frameNum, {
        key: 'head',
        type: 'Point',
      });
    }
    if (index === -1 || index === 1) {
      track.removeFeatureGeometry(frameNum, {
        key: 'tail',
        type: 'Point',
      });
    }
  }

  update(
    frameNum: number,
    track: Track,
    key: string,
    data: GeoJSON.LineString | GeoJSON.Polygon,
  ) {
    console.log('update headtail');
    const linestring = data as GeoJSON.LineString;
    if (this.active.value) {
      console.log(frameNum, track.trackId, key, data, this);
      if (linestring.coordinates.length === 2) {
        const headFeature: GeoJSON.Feature<GeoJSON.Point> = {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [linestring.coordinates[0][0], linestring.coordinates[0][1]],
          },
          properties: {},
        };
        const tailFeature: GeoJSON.Feature<GeoJSON.Point> = {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [linestring.coordinates[1][0], linestring.coordinates[1][1]],
          },
          properties: {},
        };
        const headTailLine: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          geometry: linestring,
          properties: {},
        };
        this.active.value = false;
        return {
          data: {
            [HeadPointKey]: [headFeature],
            [TailPointKey]: [tailFeature],
            [HeadTailLineKey]: [headTailLine],
          },
          // TODO why is typescript losing its mind here.
          newMode: 'editing' as 'editing',
          newType: 'rectangle' as 'rectangle',
          newSelectedKey: HeadTailLineKey,
        };
      }
    }
    return { data: null };
  }

  activate() {
    this.active.value = true;
  }
}
