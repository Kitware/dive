import Vue, { ref, Ref } from 'vue';

import Track from 'vue-media-annotator/track';
import Recipe, { UpdateResponse } from 'vue-media-annotator/recipe';
import { EditAnnotationTypes } from 'vue-media-annotator/layers';
import { Mousetrap } from 'vue-media-annotator/types';
import { RectBounds, withinBounds } from 'vue-media-annotator/utils';

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
const PaddingVectorZero: [number, number][] = [
  [0, 0],
  [0, 0],
  [1, 0],
  [1, 0],
  [0, 0],
];

export default class HeadTail implements Recipe {
  active: Ref<boolean>;

  name: string;

  private startWithHead: boolean;

  /* Whether the track had bounds before line creation started */
  private hadBoundsOnCreate: boolean;

  bus: Vue;

  toggleable: Ref<boolean>;

  icon: Ref<string>;

  constructor() {
    this.bus = new Vue();
    this.startWithHead = true;
    this.hadBoundsOnCreate = false;
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
  private static findBounds(ls: GeoJSON.LineString, paddingVector: [number, number][]): GeoJSON.Polygon[] {
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

  private static coordsInBounds(bounds: RectBounds, coords: GeoJSON.Position[]) {
    const results: boolean[] = [];
    for (let i = 0; i < coords.length; i += 1) {
      const x = coords[i][0];
      const y = coords[i][1];
      results.push(withinBounds([x, y], bounds));
    }
    return (results.filter((item) => item).length === coords.length);
  }

  /**
   * Compute a tight axis-aligned bounding box around coords, expanded by fraction
   * (e.g. 0.10 = 10% larger in each dimension).
   */
  private static tightBoundsExpanded(
    coords: GeoJSON.Position[],
    fraction: number,
  ): GeoJSON.Polygon[] {
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    // Use the other dimension as fallback for degenerate (zero-width/height) cases
    const padX = width * fraction || height * fraction;
    const padY = height * fraction || width * fraction;
    return [{
      type: 'Polygon',
      coordinates: [[
        [minX - padX, minY - padY],
        [minX - padX, maxY + padY],
        [maxX + padX, maxY + padY],
        [maxX + padX, minY - padY],
        [minX - padX, minY - padY],
      ]],
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
        const currentFeature = track.features.find((item) => item && item.frame === frameNum);
        let bounds: RectBounds | null = null;
        if (currentFeature && currentFeature.bounds) {
          bounds = currentFeature.bounds;
        }
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
          let union: GeoJSON.Polygon[];
          if (bounds !== null) {
            // If both are inside of the bbox don't adjust the union
            if (HeadTail.coordsInBounds(bounds, geom.coordinates)) {
              union = [];
            } else if (tail.length > 0) { // If creating new box add padding
              union = HeadTail.findBounds(geom, PaddingVectorZero);
            } else {
              union = HeadTail.findBounds(geom, PaddingVector);
            }
          } else {
            // No existing box: make box 10% larger than tight box around vertices
            union = HeadTail.tightBoundsExpanded(geom.coordinates, 0.10);
          }
          // Both head and tail placed, replace them.
          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(geom, this.startWithHead),
            newSelectedKey: HeadTailLineKey,
            done: true,
            union,
          } as UpdateResponse;
        }
        if (geom.coordinates.length === 1) {
          // Only the head placed so far — record if the track already had bounds
          this.hadBoundsOnCreate = bounds !== null;
          let union = HeadTail.findBounds(geom, PaddingVector);
          if (bounds !== null) {
            if (HeadTail.coordsInBounds(bounds, geom.coordinates)) {
              union = [];
            }
          }

          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(geom, this.startWithHead),
            union,
            done: false,
          };
        }
      }
      if (key === HeadTailLineKey && mode === 'editing') {
      /**
       * IF recipe isn't active, but the key matches, we are editing
       */
        if (this.active.value && !this.hadBoundsOnCreate) {
          // Creating a new line on a track without a pre-existing box:
          // use unionWithoutBounds to replace interim bounds with 10% expanded box
          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(linestring.geometry, true),
            unionWithoutBounds: HeadTail.tightBoundsExpanded(linestring.geometry.coordinates, 0.20),
            done: true,
          };
        }
        return {
          ...EmptyResponse,
          data: HeadTail.makeGeom(linestring.geometry, true),
          union: HeadTail.findBounds(linestring.geometry, PaddingVectorZero),
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
