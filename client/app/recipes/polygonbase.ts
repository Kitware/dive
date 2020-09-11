import { ref, Ref } from '@vue/composition-api';

import Track from 'vue-media-annotator/track';
import Recipe, { UpdateResponse } from 'vue-media-annotator/recipe';

const EmptyResponse = { data: {}, union: [], unionWithoutBounds: [] };

export default class PolygonBoundsExpand implements Recipe {
  active: Ref<boolean>;

  name: string;

  constructor() {
    this.active = ref(true);
    this.name = 'PolygonBase';
  }

  update(
    mode: 'in-progress' | 'editing',
    frameNum: number,
    track: Track,
    data: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point>[],
    key?: string,
  ) {
    if (data.length === 1 && mode === 'editing' && this.active.value) {
      const poly = data[0].geometry;
      if (poly.type === 'Polygon') {
        return {
          data: {
            [key || '']: data,
          },
          union: [],
          unionWithoutBounds: [poly],
        };
      }
    }
    return EmptyResponse;
  }

  // eslint-disable-next-line class-methods-use-this
  activate() {
    // no-op
    return {};
  }

  // eslint-disable-next-line class-methods-use-this
  deactivate() {
    // no-op
  }
}
