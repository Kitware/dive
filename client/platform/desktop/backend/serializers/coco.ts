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

type CocoAnnotation = {
  id: number;
  image_id: number;
  category_id: number;
  bbox: [number, number, number, number];
  score?: number;
  track_id?: number;
  keypoints?: number[];
  segmentation?: number[][];
  dive_detection_attributes?: Record<string, unknown>;
  dive_track_attributes?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  track_attributes?: Record<string, unknown>;
};

type CocoDocument = {
  info?: Record<string, unknown>;
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
};

function buildFeatureGeometry(
  annotation: CocoAnnotation,
  category?: CocoCategory,
): GeoJSON.FeatureCollection<TrackSupportedFeature, GeoJSON.GeoJsonProperties> | undefined {
  const geometryFeatures:
    GeoJSON.Feature<TrackSupportedFeature, GeoJSON.GeoJsonProperties>[] = [];
  const { segmentation } = annotation;
  if (segmentation) {
    if (!Array.isArray(segmentation)) {
      throw new Error('Run-length encoded COCO segmentation is not supported');
    }
    const polygons = (
      segmentation.length > 0 && typeof segmentation[0] === 'number'
        ? [segmentation]
        : segmentation
    ) as number[][];
    polygons.forEach((polygon) => {
      const coords: number[][] = [];
      for (let i = 0; i + 1 < polygon.length; i += 2) {
        coords.push([polygon[i], polygon[i + 1]]);
      }
      if (coords.length) {
        geometryFeatures.push({
          type: 'Feature',
          properties: { key: '' },
          geometry: {
            type: 'Polygon',
            coordinates: [coords],
          },
        });
      }
    });
  }

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

  if (!geometryFeatures.length) return undefined;
  return {
    type: 'FeatureCollection' as const,
    features: geometryFeatures,
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

async function parseFile(path: string): Promise<[AnnotationSchema, Record<string, unknown>]> {
  const parsed = await fs.readJSON(path);
  if (!isCocoJson(parsed)) {
    throw new Error('JSON does not match COCO format');
  }
  const categoriesById = Object.fromEntries(parsed.categories.map((c) => [c.id, c]));
  const frameByImageId = imageFrameMap(parsed);
  const tracks: AnnotationSchema['tracks'] = {};

  parsed.annotations.forEach((annotation) => {
    const frame = frameByImageId[annotation.image_id];
    if (frame === undefined) return;
    const [x, y, w, h] = annotation.bbox;
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
    const geometry = buildFeatureGeometry(annotation, category);
    if (geometry) {
      feature.geometry = geometry;
    }
    track.features.push(feature);
    track.confidencePairs = confidencePairs;
  });

  const annotations: AnnotationSchema = { version: 2, tracks, groups: {} };
  const processed = processTrackAttributes(Object.values(annotations.tracks));
  return [annotations, { attributes: processed.attributes }];
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
      dive_extensions: ['dive_detection_attributes', 'dive_track_attributes'],
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
