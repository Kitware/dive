import fs from 'fs-extra';
import { AnnotationSchema } from 'dive-common/apispec';
import { JsonMeta } from 'platform/desktop/constants';
import processTrackAttributes from 'platform/desktop/backend/native/attributeProcessor';
import { TrackSupportedFeature } from 'vue-media-annotator/track';

type CocoImage = {
  id: number;
  file_name: string;
  frame_index?: number;
};

type CocoCategory = {
  id: number;
  name: string;
  keypoints?: string[];
};

const RLE_SEGMENTATION_WARNING = (
  'The COCO file included run-length encoded segmentation masks that are not supported. '
  + 'Bounding boxes and other annotation data were imported, but masks were skipped.'
);

function hasValidBbox(annotation: CocoAnnotation): boolean {
  const { bbox } = annotation;
  return Array.isArray(bbox) && bbox.length === 4;
}

function extractPolygonCoordsLists(
  segmentation: CocoAnnotation['segmentation'],
): [number, number][][] {
  if (!segmentation || !Array.isArray(segmentation)) {
    return [];
  }
  const polygons = (
    segmentation.length > 0 && typeof segmentation[0] === 'number'
      ? [segmentation as number[]]
      : segmentation
  ) as Array<number[] | Record<string, unknown>>;
  const coordLists: [number, number][][] = [];
  polygons.forEach((polygon) => {
    if (Array.isArray(polygon)) {
      const coords: [number, number][] = [];
      for (let i = 0; i + 1 < polygon.length; i += 2) {
        coords.push([polygon[i], polygon[i + 1]]);
      }
      if (coords.length) {
        coordLists.push(coords);
      }
    }
  });
  return coordLists;
}

function bboxFromPoints(points: [number, number][]): [number, number, number, number] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  return [xMin, yMin, Math.max(...xs) - xMin, Math.max(...ys) - yMin];
}

function annotationHasImportableBounds(annotation: CocoAnnotation): boolean {
  if (hasValidBbox(annotation)) {
    return true;
  }
  if (hasRleSegmentation(annotation)) {
    return false;
  }
  return extractPolygonCoordsLists(annotation.segmentation).length > 0;
}

function missingBoundsError(annotationIds: Array<number | string>): string {
  const shown = annotationIds.slice(0, 10).join(', ');
  const extra = annotationIds.length > 10 ? ` (and ${annotationIds.length - 10} more)` : '';
  return (
    `${annotationIds.length} COCO annotation(s) cannot be imported because they have no bbox and `
    + `no usable polygon segmentation (ids: ${shown}${extra}). `
    + 'Provide bbox [x, y, width, height] or polygon segmentation as [[x1, y1, ...]]. '
    + 'Annotations with only RLE segmentation masks still require a bbox.'
  );
}

function resolveCocoBbox(annotation: CocoAnnotation): [number, number, number, number] {
  if (hasValidBbox(annotation)) {
    return annotation.bbox as [number, number, number, number];
  }
  const allPoints = extractPolygonCoordsLists(annotation.segmentation).flat();
  if (allPoints.length) {
    return bboxFromPoints(allPoints);
  }
  throw new Error(missingBoundsError([annotation.id]));
}

function validateAnnotationBounds(annotations: CocoAnnotation[]): void {
  const missingIds = annotations
    .filter((annotation) => !annotationHasImportableBounds(annotation))
    .map((annotation) => annotation.id);
  if (missingIds.length) {
    throw new Error(missingBoundsError(missingIds));
  }
}

type CocoAnnotation = {
  id: number;
  image_id: number;
  category_id: number;
  bbox?: [number, number, number, number];
  score?: number;
  track_id?: number;
  /**
   * COCO `iscrowd` flag (0 or 1). In the COCO spec, 0 means a single instance with
   * polygon `segmentation` ([[x1, y1, ...]]); 1 means a crowd region whose
   * `segmentation` is run-length encoded (RLE) as an object (e.g. { counts, size }).
   * DIVE does not import RLE masks: when `iscrowd` is truthy, or `segmentation` is
   * a dict, polygon/mask geometry is skipped (bbox and other fields still import).
   */
  iscrowd?: number;
  keypoints?: number[];
  segmentation?: number[][] | Record<string, unknown>;
  dive_detection_attributes?: Record<string, unknown>;
  dive_track_attributes?: Record<string, unknown>;
  dive_notes?: string[];
  notes?: string[] | string;
  attributes?: Record<string, unknown>;
  track_attributes?: Record<string, unknown>;
};

type CocoDocument = {
  info?: Record<string, unknown>;
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
};

/** True when segmentation is COCO RLE (crowd / `iscrowd: 1`), which DIVE does not decode. */
function hasRleSegmentation(annotation: CocoAnnotation): boolean {
  if (annotation.iscrowd) {
    return true;
  }
  const { segmentation } = annotation;
  return Boolean(segmentation) && !Array.isArray(segmentation);
}

function buildFeatureGeometry(
  annotation: CocoAnnotation,
  category?: CocoCategory,
): { geometry?: GeoJSON.FeatureCollection<TrackSupportedFeature, GeoJSON.GeoJsonProperties>; rleSkipped: boolean } {
  if (hasRleSegmentation(annotation)) {
    return { rleSkipped: true };
  }
  const geometryFeatures:
    GeoJSON.Feature<TrackSupportedFeature, GeoJSON.GeoJsonProperties>[] = [];
  const coordLists = extractPolygonCoordsLists(annotation.segmentation);
  coordLists.forEach((coords) => {
    geometryFeatures.push({
      type: 'Feature',
      properties: { key: '' },
      geometry: {
        type: 'Polygon',
        coordinates: [coords],
      },
    });
  });

  const keypoints = annotation.keypoints || [];
  if (Array.isArray(keypoints) && keypoints.length >= 3) {
    const labels = category?.keypoints || [];
    const headTail: [number, number][] = [];
    for (let i = 0; i + 2 < keypoints.length; i += 3) {
      const label = labels[Math.floor(i / 3)];
      if (label === 'head' || label === 'tail') {
        const x = keypoints[i];
        const y = keypoints[i + 1];
        const visible = keypoints[i + 2] > 0;
        if (visible) {
          const point: [number, number] = [x, y];
          headTail.push(point);
          geometryFeatures.push({
            type: 'Feature',
            properties: { key: label },
            geometry: {
              type: 'Point',
              coordinates: point,
            },
          });
        }
      }
    }
    if (headTail.length === 2) {
      geometryFeatures.push({
        type: 'Feature',
        properties: { key: 'HeadTails' },
        geometry: {
          type: 'LineString',
          coordinates: headTail,
        },
      });
    }
  }

  if (!geometryFeatures.length) {
    return { rleSkipped: false };
  }
  return {
    geometry: {
      type: 'FeatureCollection' as const,
      features: geometryFeatures,
    },
    rleSkipped: false,
  };
}

function isCocoJson(value: unknown): value is CocoDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<CocoDocument>;
  return Array.isArray(document.images)
    && Array.isArray(document.annotations)
    && Array.isArray(document.categories);
}

function imageFrameMap(document: CocoDocument): Record<number, number> {
  const sorted = [...document.images].sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true }));
  const map: Record<number, number> = {};
  sorted.forEach((img, idx) => {
    map[img.id] = img.frame_index ?? idx;
  });
  return map;
}

async function parseFile(path: string): Promise<[AnnotationSchema, Record<string, unknown>, string[]]> {
  const parsed = await fs.readJSON(path);
  if (!isCocoJson(parsed)) {
    throw new Error('JSON does not match COCO format');
  }
  const categoriesById = Object.fromEntries(parsed.categories.map((c) => [c.id, c]));
  const frameByImageId = imageFrameMap(parsed);
  const tracks: AnnotationSchema['tracks'] = {};
  let skippedRleMasks = false;

  validateAnnotationBounds(parsed.annotations);

  parsed.annotations.forEach((annotation) => {
    const frame = frameByImageId[annotation.image_id];
    if (frame === undefined) return;
    const [x, y, w, h] = resolveCocoBbox(annotation);
    const bounds: [number, number, number, number] = [x, y, x + w, y + h];
    const trackId = annotation.track_id ?? annotation.id;
    const category = categoriesById[annotation.category_id];
    const confidencePairs: [string, number][] = [[category?.name ?? 'unknown', annotation.score ?? 1.0]];
    if (!tracks[trackId]) {
      tracks[trackId] = {
        id: trackId,
        begin: frame,
        end: frame,
        attributes: {},
        confidencePairs,
        features: [],
      };
    }
    const track = tracks[trackId];
    const trackAttributes = annotation.dive_track_attributes || annotation.track_attributes;
    if (trackAttributes && typeof trackAttributes === 'object') {
      track.attributes = { ...track.attributes, ...trackAttributes };
    }
    track.begin = Math.min(track.begin, frame);
    track.end = Math.max(track.end, frame);
    const feature: AnnotationSchema['tracks'][number]['features'][number] = {
      frame,
      bounds,
    };
    const featureAttributes = annotation.dive_detection_attributes || annotation.attributes;
    if (featureAttributes && typeof featureAttributes === 'object') {
      feature.attributes = featureAttributes;
    }
    const noteField = annotation.dive_notes ?? annotation.notes;
    if (Array.isArray(noteField)) {
      const normalized = noteField
        .map((entry) => `${entry}`.trim())
        .filter((entry) => entry.length > 0);
      if (normalized.length) {
        feature.notes = normalized;
      }
    } else if (typeof noteField === 'string' && noteField.trim()) {
      feature.notes = [noteField.trim()];
    }
    const { geometry, rleSkipped } = buildFeatureGeometry(annotation, category);
    if (rleSkipped) {
      skippedRleMasks = true;
    }
    if (geometry) {
      feature.geometry = geometry;
    }
    track.features.push(feature);
    track.confidencePairs = confidencePairs;
  });

  const annotations: AnnotationSchema = { version: 2, tracks, groups: {} };
  const processed = processTrackAttributes(Object.values(annotations.tracks));
  const warnings = skippedRleMasks ? [RLE_SEGMENTATION_WARNING] : [];
  return [annotations, { attributes: processed.attributes }, warnings];
}

function frameNameForExport(frame: number, meta: JsonMeta): string {
  if (meta.type === 'image-sequence') {
    return meta.originalImageFiles[frame] || `frame_${frame.toString().padStart(6, '0')}.jpg`;
  }
  return `frame_${frame.toString().padStart(6, '0')}.jpg`;
}

async function serializeFile(
  path: string,
  data: AnnotationSchema,
  meta: JsonMeta,
  typeFilter = new Set<string>(),
  options = {
    excludeBelowThreshold: false,
  },
) {
  const categories = new Map<string, number>();
  const images = new Map<number, CocoImage>();
  const annotations: CocoAnnotation[] = [];
  let annotationId = 1;
  const thresholds = meta.confidenceFilters || {};
  const defaultThreshold = thresholds.default ?? 0;

  Object.values(data.tracks).forEach((track) => {
    const filteredPairs = track.confidencePairs.filter(([name, score]) => {
      const keepType = typeFilter.size === 0 || typeFilter.has(name);
      const keepThreshold = !options.excludeBelowThreshold || score >= (thresholds[name] ?? defaultThreshold);
      return keepType && keepThreshold;
    });
    if (!filteredPairs.length) return;
    const [className, score] = [...filteredPairs].sort((a, b) => b[1] - a[1])[0];
    const categoryId = categories.get(className) || (categories.size + 1);
    categories.set(className, categoryId);

    track.features.forEach((feature) => {
      if (!feature.bounds) return;
      const [x1, y1, x2, y2] = feature.bounds;
      const imageId = feature.frame + 1;
      if (!images.has(imageId)) {
        images.set(imageId, {
          id: imageId,
          file_name: frameNameForExport(feature.frame, meta),
          frame_index: feature.frame,
        });
      }
      annotations.push({
        id: annotationId,
        image_id: imageId,
        category_id: categoryId,
        track_id: track.id,
        bbox: [x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1)],
        score,
        ...(feature.attributes ? { dive_detection_attributes: feature.attributes } : {}),
        ...(track.attributes ? { dive_track_attributes: track.attributes } : {}),
        ...(feature.notes && feature.notes.length > 0 ? { dive_notes: feature.notes } : {}),
      });
      annotationId += 1;
    });
  });

  const categoryDocs: CocoCategory[] = Array.from(categories.entries()).map(([name, id]) => ({
    id,
    name,
    keypoints: ['head', 'tail'],
  }));
  const output: CocoDocument = {
    info: {
      description: `DIVE export for ${meta.name}`,
      dive_extensions: ['dive_detection_attributes', 'dive_track_attributes', 'dive_notes'],
    },
    images: Array.from(images.values()),
    annotations,
    categories: categoryDocs,
  };
  await fs.writeJSON(path, output, { spaces: 2 });
  return path;
}

export {
  isCocoJson,
  parseFile,
  serializeFile,
};
