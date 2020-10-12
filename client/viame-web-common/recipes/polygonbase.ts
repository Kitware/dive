import { cloneDeep } from 'lodash';
import { ref, Ref } from '@vue/composition-api';
import Vue from 'vue';

import { removePoint } from 'vue-media-annotator/utils';
import Track from 'vue-media-annotator/track';
import Recipe from 'vue-media-annotator/recipe';
import { EditAnnotationTypes } from 'vue-media-annotator/layers';

const EmptyResponse = { data: {}, union: [], unionWithoutBounds: [] };

export default class PolygonBoundsExpand implements Recipe {
  active: Ref<boolean>;

  name: string;

  icon: Ref<string>;

  toggleable: Ref<boolean>;

  bus: Vue;

  constructor() {
    this.bus = new Vue();
    this.active = ref(false);
    this.name = 'PolygonBase';
    this.toggleable = ref(true);
    this.icon = ref('mdi-vector-polygon');
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
          done: true,
          unionWithoutBounds: [poly],
        };
      }
    }
    return EmptyResponse;
  }

  // eslint-disable-next-line class-methods-use-this
  delete(frame: number, track: Track, key: string, type: EditAnnotationTypes) {
    if (key === '' && type === 'Polygon') {
      track.removeFeatureGeometry(frame, { key: '', type: 'Polygon' });
    }
  }

  // eslint-disable-next-line class-methods-use-this
  deletePoint(frame: number, track: Track, idx: number, key: string, type: EditAnnotationTypes) {
    if (key === '' && type === 'Polygon') {
      const geoJsonFeatures = track.getFeatureGeometry(frame, {
        type: 'Polygon',
        key: '',
      });
      if (geoJsonFeatures.length === 0) return;
      const clone = cloneDeep(geoJsonFeatures[0]);
      if (removePoint(clone, idx)) {
        track.setFeature({ frame }, [clone]);
      }
    }
  }

  // eslint-disable-next-line class-methods-use-this
  activate() {
    // no-op
    this.active.value = true;
    this.bus.$emit('activate', {
      editing: 'Polygon' as EditAnnotationTypes,
      key: '',
      recipeName: this.name,
    });
  }

  // eslint-disable-next-line class-methods-use-this
  deactivate() {
    // no-op
    this.active.value = false;
  }

  // eslint-disable-next-line class-methods-use-this
  mousetrap() {
    return [];
  }
}
