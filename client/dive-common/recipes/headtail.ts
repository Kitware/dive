import Vue, { ref, Ref } from 'vue';

import Track from 'vue-media-annotator/track';
import { headTailFeatures, isHeadTailPoint } from 'vue-media-annotator/headTail';
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
/* Cap how skinny a line's box may get: longer side at most this x the shorter. */
const MAX_BOX_ASPECT_RATIO = 6;

export default class HeadTail implements Recipe {
  active: Ref<boolean>;

  name: string;

  private startWithHead: boolean;

  /* Only the initial completion of a newly boxed line may replace its interim box. */
  private initialBoundsTarget: { track: Track; frame: number } | null;

  bus: Vue;

  toggleable: Ref<boolean>;

  icon: Ref<string>;

  constructor() {
    this.bus = new Vue();
    this.startWithHead = true;
    this.initialBoundsTarget = null;
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
    if (coords.length > 2) return HeadTail.tightBoundsExpanded(coords, 0);
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

  /** Expand an existing box only enough to enclose outlying vertices. */
  private static encloseVertices(bounds: RectBounds, coordinates: GeoJSON.Position[]): GeoJSON.Polygon[] {
    if (HeadTail.coordsInBounds(bounds, coordinates)) return [];
    const xs = coordinates.map((p) => p[0]);
    const ys = coordinates.map((p) => p[1]);
    // Track stores integer boxes; round outward so fractional points stay inside.
    const x0 = Math.floor(Math.min(...xs)); const x1 = Math.ceil(Math.max(...xs));
    const y0 = Math.floor(Math.min(...ys)); const y1 = Math.ceil(Math.max(...ys));
    return [{ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }];
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
    let x0 = minX - padX;
    let x1 = maxX + padX;
    let y0 = minY - padY;
    let y1 = maxY + padY;

    // Cap the aspect ratio so a near-horizontal/vertical line doesn't make a
    // razor-thin box: grow the shorter side about its center until the
    // longer:shorter ratio is at most MAX_BOX_ASPECT_RATIO.
    const boxW = x1 - x0;
    const boxH = y1 - y0;
    if (boxW > 0 && boxH > 0) {
      if (boxW / boxH > MAX_BOX_ASPECT_RATIO) {
        const grow = (boxW / MAX_BOX_ASPECT_RATIO - boxH) / 2;
        y0 -= grow;
        y1 += grow;
      } else if (boxH / boxW > MAX_BOX_ASPECT_RATIO) {
        const grow = (boxH / MAX_BOX_ASPECT_RATIO - boxW) / 2;
        x0 -= grow;
        x1 += grow;
      }
    }
    return [{
      type: 'Polygon',
      coordinates: [[
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
        [x0, y0],
      ]],
    }];
  }

  private static makeGeom(ls: GeoJSON.LineString, startWithHead: boolean) {
    const coordinates = ls.coordinates.map((p) => [...p]);
    if (coordinates.length < 2) {
      return {
        [startWithHead ? HeadPointKey : TailPointKey]: [{
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'Point' as const, coordinates: coordinates[0] },
        }],
      };
    }
    if (!startWithHead) coordinates.reverse();
    const result: Record<string, GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon>[]> = {};
    headTailFeatures(coordinates).forEach((f) => { result[f.properties?.key] = [f]; });
    return result;
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
          const initialBounds = (this.initialBoundsTarget?.track === track && this.initialBoundsTarget.frame === frameNum) || bounds === null;
          this.initialBoundsTarget = null;
          const union = initialBounds ? [] : HeadTail.encloseVertices(bounds!, geom.coordinates);
          // Both head and tail placed, replace them.
          return {
            ...EmptyResponse,
            data: HeadTail.makeGeom(geom, this.startWithHead),
            newSelectedKey: HeadTailLineKey,
            done: true,
            union,
            unionWithoutBounds: initialBounds ? HeadTail.tightBoundsExpanded(geom.coordinates, 0.10) : [],
          } as UpdateResponse;
        }
        if (geom.coordinates.length === 1) {
          // Only the head placed so far — record if the track already had bounds
          this.initialBoundsTarget = bounds === null ? { track, frame: frameNum } : null;
          let union = HeadTail.findBounds(geom, PaddingVector);
          if (bounds !== null) union = HeadTail.encloseVertices(bounds, geom.coordinates);

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
        const bounds = track.getFeature(frameNum)[0]?.bounds;
        const initialBounds = (this.initialBoundsTarget?.track === track && this.initialBoundsTarget.frame === frameNum) || !bounds;
        this.initialBoundsTarget = null;
        if (initialBounds) {
          // Creating a new line on a track without a pre-existing box:
          // use unionWithoutBounds to replace interim bounds with 20% expanded box
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
          union: HeadTail.encloseVertices(bounds!, linestring.geometry.coordinates),
          done: true,
        };
      }
    }
    return EmptyResponse;
  }

  // eslint-disable-next-line class-methods-use-this
  delete(frame: number, track: Track, key: string, type: EditAnnotationTypes) {
    if (key === HeadTailLineKey && type === 'LineString') {
      track.getFeatureGeometry(frame, { type: 'Point' }).forEach((f) => {
        if (isHeadTailPoint(f.properties?.key || '')) track.removeFeatureGeometry(frame, { type: 'Point', key: f.properties?.key });
      });
      track.removeFeatureGeometry(frame, { type: 'Point', key: TailPointKey });
      track.removeFeatureGeometry(frame, { type: 'LineString', key: HeadTailLineKey });
      track.setFeature({ frame, head: undefined, tail: undefined });
      track.invalidateMeasurement(frame);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  deletePoint(frame: number, track: Track, idx: number, key: string, type: EditAnnotationTypes) {
    if (key === HeadTailLineKey && type === 'LineString') {
      const line = track.getFeatureGeometry(frame, { type: 'LineString', key: HeadTailLineKey })[0];
      if (!line || line.geometry.type !== 'LineString') return;
      const coordinates = line.geometry.coordinates.map((p) => [...p]);
      if (idx < 0 || idx >= coordinates.length) return;
      if (coordinates.length > 2) {
        coordinates.splice(idx, 1);
        track.setFeature({ frame }, headTailFeatures(coordinates));
      } else {
        track.removeFeatureGeometry(frame, { type: 'LineString', key: HeadTailLineKey });
        track.removeFeatureGeometry(frame, { type: 'Point', key: idx === 0 ? HeadPointKey : TailPointKey });
        track.setFeature({ frame, [idx === 0 ? 'head' : 'tail']: undefined });
        track.invalidateMeasurement(frame);
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
    this.initialBoundsTarget = null;
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
