import { cloneDeep } from 'lodash';
import Vue, { ref, Ref } from 'vue';

import { removePoint } from 'vue-media-annotator/utils';
import Track from 'vue-media-annotator/track';
import Recipe from 'vue-media-annotator/recipe';
import { EditAnnotationTypes } from 'vue-media-annotator/layers';

const EmptyResponse = { data: {}, union: [], unionWithoutBounds: [] };

/**
 * Check if a point is inside a polygon using ray casting algorithm
 * @param point [x, y] coordinates
 * @param polygon array of [x, y] coordinates forming the polygon (outer ring only)
 * @returns true if point is inside polygon
 */
function isPointInsidePolygon(point: [number, number], polygon: GeoJSON.Position[]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if all vertices of polygon P are inside polygon E
 * @param innerPolygon polygon to check if it's inside
 * @param outerPolygon polygon to check if it contains the inner polygon
 * @returns true if all vertices of innerPolygon are inside outerPolygon
 */
function isPolygonInsidePolygon(
  innerPolygon: GeoJSON.Position[],
  outerPolygon: GeoJSON.Position[],
): boolean {
  // Check if all vertices of the inner polygon are inside the outer polygon
  return innerPolygon.every(
    (vertex) => isPointInsidePolygon([vertex[0], vertex[1]], outerPolygon),
  );
}

export default class PolygonBoundsExpand implements Recipe {
  active: Ref<boolean>;

  name: string;

  icon: Ref<string>;

  toggleable: Ref<boolean>;

  bus: Vue;

  // Mode for adding polygons: 'normal', 'hole', or 'newPolygon'
  addingMode: Ref<'normal' | 'hole' | 'newPolygon'>;

  constructor() {
    this.bus = new Vue();
    this.active = ref(false);
    this.name = 'PolygonBase';
    this.toggleable = ref(true);
    this.icon = ref('mdi-vector-polygon');
    this.addingMode = ref('normal');
  }

  setAddingHole() {
    this.addingMode.value = 'hole';
    // Emit activate event with special key to trigger creation mode
    this.bus.$emit('activate', {
      editing: 'Polygon' as EditAnnotationTypes,
      key: '__adding_hole__',
      recipeName: this.name,
    });
  }

  setAddingPolygon(newKey: string) {
    this.addingMode.value = 'newPolygon';
    // Emit activate event with new key to trigger creation mode
    this.bus.$emit('activate', {
      editing: 'Polygon' as EditAnnotationTypes,
      key: newKey,
      recipeName: this.name,
    });
  }

  resetAddingMode() {
    this.addingMode.value = 'normal';
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
        const newPolyCoords = poly.coordinates[0] as GeoJSON.Position[];
        const currentMode = this.addingMode.value;

        // Reset adding mode after processing
        this.resetAddingMode();

        if (currentMode === 'hole' || key === '__adding_hole__') {
          // Adding a hole - find the first polygon and add hole to it
          const existingPolygons = track.getPolygonFeatures(frameNum);
          if (existingPolygons.length > 0) {
            // Add as hole to the first (default) polygon
            const targetPoly = existingPolygons[0];
            track.addHoleToPolygon(frameNum, targetPoly.key, newPolyCoords);
            return {
              data: {},
              union: [],
              done: true,
              unionWithoutBounds: [],
              newSelectedKey: targetPoly.key, // Reset to the polygon's key
            };
          }
          // No existing polygon, treat as normal (create first polygon)
          return {
            data: {
              '': data,
            },
            union: [],
            done: true,
            unionWithoutBounds: [poly],
            newSelectedKey: '',
          };
        }

        if (currentMode === 'newPolygon') {
          // Adding a new separate polygon - key should already be set to new value
          const useKey = key || track.getNextPolygonKey(frameNum);
          const newFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
            type: 'Feature',
            properties: { key: useKey },
            geometry: poly,
          };
          return {
            data: {
              [useKey]: [newFeature],
            },
            union: [poly], // Use union to EXPAND bounds, not replace them
            done: true,
            unionWithoutBounds: [],
            newSelectedKey: '', // Reset to default polygon for future edits
          };
        }

        // Standard case: save polygon with the given key
        // Calculate bounds from ALL polygons in the detection, not just the edited one
        const allPolygons = track.getPolygonFeatures(frameNum);
        const otherPolygons: GeoJSON.Polygon[] = allPolygons
          .filter((p) => p.key !== (key || ''))
          .map((p) => p.geometry);

        return {
          data: {
            [key || '']: data,
          },
          // Use union with other polygons to ensure bounds encompass all
          union: otherPolygons,
          done: true,
          // The edited polygon replaces the base bounds
          unionWithoutBounds: [poly],
        };
      }
    }
    return EmptyResponse;
  }

  /**
   * Add a polygon as a hole to an existing polygon, or as a new separate polygon.
   * Call this method explicitly when auto-hole detection is desired.
   */
  // eslint-disable-next-line class-methods-use-this
  addPolygonWithHoleDetection(
    frameNum: number,
    track: Track,
    poly: GeoJSON.Polygon,
    key?: string,
  ) {
    const newPolyCoords = poly.coordinates[0] as GeoJSON.Position[];

    // Get existing polygons for this frame
    const existingPolygons = track.getPolygonFeatures(frameNum);

    // Check if this is an edit to an existing polygon (key matches)
    const isExistingEdit = existingPolygons.some((p) => p.key === (key || ''));

    if (!isExistingEdit && existingPolygons.length > 0) {
      // This is a new polygon - check if it should be a hole in an existing polygon
      const containingPoly = existingPolygons.find((existingPoly) => {
        const outerRing = existingPoly.geometry.coordinates[0] as GeoJSON.Position[];
        return isPolygonInsidePolygon(newPolyCoords, outerRing);
      });

      if (containingPoly) {
        // New polygon is inside existing polygon - add as hole
        track.addHoleToPolygon(frameNum, containingPoly.key, newPolyCoords);
        return { isHole: true, key: containingPoly.key };
      }

      // Not inside any existing polygon - add as new separate polygon with auto-key
      const newKey = track.getNextPolygonKey(frameNum);
      return { isHole: false, key: newKey };
    }

    // Standard case: use provided key or default
    return { isHole: false, key: key || '' };
  }

  // eslint-disable-next-line class-methods-use-this
  delete(frame: number, track: Track, key: string, type: EditAnnotationTypes) {
    if (type === 'Polygon') {
      // Remove polygon with the specified key (supports multiple polygons)
      track.removeFeatureGeometry(frame, { key, type: 'Polygon' });
    }
  }

  // eslint-disable-next-line class-methods-use-this
  deletePoint(frame: number, track: Track, idx: number, key: string, type: EditAnnotationTypes) {
    if (type === 'Polygon') {
      const geoJsonFeatures = track.getFeatureGeometry(frame, {
        type: 'Polygon',
        key,
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
