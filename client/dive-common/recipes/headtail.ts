import { ref, Ref } from '@vue/composition-api';
import Vue from 'vue';

import Track from 'vue-media-annotator/track';
import Recipe, { UpdateResponse } from 'vue-media-annotator/recipe';
import { EditAnnotationTypes } from 'vue-media-annotator/layers';
import { Mousetrap } from 'vue-media-annotator/types';

export const HeadTailLineKey = 'HeadTails';
export const HeadPointKey = 'head';
export const TailPointKey = 'tail';
const EmptyResponse: UpdateResponse = { data: {}, union: [], unionWithoutBounds: [] };

/* Standard 10% padding */
const PaddingVector: [number, number][] = [
  [-0.10, -0.10],
  [-0.10, 0.10],
  [1.10, -0.10],
  [1.10, 0.10],
  [-0.10, -0.10],
];
/* No padding */
// const PaddingVectorZero: [number, number][] = [
//   [0, 0],
//   [0, 0],
//   [1, 0],
//   [1, 0],
//   [0, 0],
// ];

export default class HeadTail implements Recipe {
  active: Ref<boolean>;

  name: string;

  private startWithHead: boolean;

  bus: Vue;

  toggleable: Ref<boolean>;

  icon: Ref<string>;

  constructor() {
    this.bus = new Vue();
    this.startWithHead = true;
    this.active = ref(false);
    this.name = 'HeadTail';
    this.toggleable = ref(true);
    this.icon = ref('mdi-vector-line');
  }

  /**
   * findBounds computes a padding polygon around the linestring given paddingVector
   * @param ls Linestring
   * @param paddingVector polypoints in terms of C and CPerp
   */
  private static findBounds(
    ls: GeoJSON.LineString, paddingVector: [number, number][],
  ): GeoJSON.Polygon[] {
    // Coords = [ Vec A, Vec B ]
    const coords = ls.coordinates;
    if (coords.length === 2) {
      // vec = B - A
      const vec = [
        coords[1][0] - coords[0][0],
        coords[1][1] - coords[0][1],
      ];
      // perpendicular vector
      const vecPerp = [
        -1 * vec[1],
        vec[0],
      ];
      if (paddingVector.length !== 5) {
        throw new Error('Padding vector must have length 5');
      }
      return [{
        type: 'Polygon',
        coordinates: [
          paddingVector.map((p) => ([
            coords[0][0] + (p[0] * vec[0]) + (p[1] * vecPerp[0]),
            coords[0][1] + (p[0] * vec[1]) + (p[1] * vecPerp[1]),
          ])),
        ],
      }];
    }
    // If only 1 point is available so far
    return [{
      type: 'Polygon',
      coordinates: coords.map((p) => ([
        p.map((c) => c + 5),
        p.map((c) => c - 5),
      ])),
    }];
  }

  private static makeGeom(ls: GeoJSON.LineString, startWithHead: boolean) {
    const firstFeature: GeoJSON.Feature<GeoJSON.Point> = {
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
    const ret: Record<string,
      GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon>[]> = {
        [startWithHead ? HeadPointKey : TailPointKey]: [firstFeature],
      };
    if (ls.coordinates.length === 2) {
      const secondFeature: GeoJSON.Feature<GeoJSON.Point> = {
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
      if (!startWithHead) {
        ls.coordinates.reverse();
      }
      const headTailLine: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        geometry: ls,
        properties: {},
      };
      ret[startWithHead ? TailPointKey : HeadPointKey] = [secondFeature];
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
        let geom = linestring.geometry;
        const head = track.getFeatureGeometry(frameNum, { type: 'Point', key: HeadPointKey });
        const tail = track.getFeatureGeometry(frameNum, { type: 'Point', key: TailPointKey });

        if (head.length !== tail.length) {
          // If one point exists but not the other
          if (head.length > 0) {
            this.startWithHead = true;
            this.icon.value = 'mdi-vector-line';
          } else {
            this.startWithHead = false;
            this.icon.value = 'mdi-alpha-t-box-outline';
          }
          geom = {
            type: 'LineString',
            coordinates: [
              this.startWithHead
                ? head[0].geometry.coordinates
                : tail[0].geometry.coordinates,
              geom.coordinates[geom.coordinates.length - 1],
            ],
            properties: {},
          } as GeoJSON.LineString;
        }
        if (geom.coordinates.length === 2) {
          // Both head and tail placed, replace them.
          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(geom, this.startWithHead),
            newSelectedKey: HeadTailLineKey,
            done: true,
            union: HeadTail.findBounds(geom, PaddingVector),
          } as UpdateResponse;
        }
        if (geom.coordinates.length === 1) {
          // Only the head placed so far
          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(geom, this.startWithHead),
            union: HeadTail.findBounds(geom, PaddingVector),
            done: false,
          };
        }
      }
      if (key === HeadTailLineKey && mode === 'editing') {
      /**
       * IF recipe isn't active, but the key matches, we are editing
       */
        return {
          ...EmptyResponse,
          data: HeadTail.makeGeom(linestring.geometry, true),
          union: HeadTail.findBounds(linestring.geometry, PaddingVector),
          done: true,
        };
      }
    }
    return EmptyResponse;
  }

  // eslint-disable-next-line class-methods-use-this
  delete(frame: number, track: Track, key: string, type: EditAnnotationTypes) {
    if (key === HeadTailLineKey && type === 'LineString') {
      track.removeFeatureGeometry(frame, { type: 'Point', key: HeadPointKey });
      track.removeFeatureGeometry(frame, { type: 'Point', key: TailPointKey });
      track.removeFeatureGeometry(frame, { type: 'LineString', key: HeadTailLineKey });
    }
  }

  // eslint-disable-next-line class-methods-use-this
  deletePoint(frame: number, track: Track, idx: number, key: string, type: EditAnnotationTypes) {
    if (key === HeadTailLineKey && type === 'LineString') {
      track.removeFeatureGeometry(frame, { type: 'LineString', key: HeadTailLineKey });
      if (idx === 0) {
        track.removeFeatureGeometry(frame, { type: 'Point', key: HeadPointKey });
      } else {
        track.removeFeatureGeometry(frame, { type: 'Point', key: TailPointKey });
      }
    }
  }

  activate() {
    this.active.value = true;
    this.icon.value = 'mdi-vector-line';
    this.startWithHead = true;
    this.bus.$emit('activate', {
      editing: 'LineString' as EditAnnotationTypes,
      key: HeadTailLineKey,
      recipeName: this.name,
    });
  }

  deactivate() {
    this.active.value = false;
  }

  private headfirst() {
    this.activate();
    this.startWithHead = true;
    this.icon.value = 'mdi-vector-line';
  }

  private tailfirst() {
    this.activate();
    this.startWithHead = false;
    this.icon.value = 'mdi-alpha-t-box-outline';
  }

  mousetrap(): Mousetrap[] {
    return [
      { bind: 'h', handler: () => this.headfirst() },
      { bind: 't', handler: () => this.tailfirst() },
    ];
  }
}
