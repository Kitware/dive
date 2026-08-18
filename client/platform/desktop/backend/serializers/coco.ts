import fs from 'fs-extra';
import { isEmpty } from 'lodash';
import { AnnotationSchema } from 'dive-common/apispec';
import { JsonConfig } from 'platform/desktop/constants';
import processTrackAttributes from 'platform/desktop/backend/native/attributeProcessor';
import { strNumericCompare } from 'platform/desktop/sharedUtils';
import { TrackSupportedFeature } from 'vue-media-annotator/track';

type CocoImage = {
  id: number;
  file_name: string;
  frame_index?: number;
};

type CocoCategory = {
  id: number;
  name?: string;
  keypoints?: string[];
  supercategory?: string | null;
  parents?: unknown;
};

const RLE_SEGMENTATION_WARNING = (
  'The COCO file included run-length encoded segmentation masks that are not supported. '
  + 'Bounding boxes and other annotation data were imported, but masks were skipped.'
);

const PROB_TOP_K = 10;
const PROB_EPSILON = 0.001;

const PROB_LENGTH_MISMATCH_WARNING = (
  'Some annotations had a "prob" array whose length did not match the number of categories. '
  + 'Class probabilities were ignored for those annotations; the primary category and score '
  + 'were imported instead.'
);
const PROB_DUPLICATE_CATEGORY_WARNING = (
  'The COCO file contains duplicate category names, so "prob" arrays cannot be mapped to '
  + 'class names. Class probabilities were ignored; primary categories and scores were '
  + 'imported instead.'
);
const DIVE_CONFIDENCE_PAIRS_INVALID_WARNING = (
  'Some annotations had malformed "dive_confidence_pairs" values. Those values were '
  + 'ignored; a valid "prob" vector or the primary category and score were imported instead.'
);
const SUPERCATEGORY_MULTI_PARENT_WARNING = (
  'Some COCO categories declare multiple parents via "parents", which DIVE cannot '
  + 'represent. Only single-parent "supercategory" or one-element "parents" edges were imported.'
);
const SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING = (
  'The COCO file contains duplicate category names, so category hierarchy edges cannot be '
  + 'mapped to class names. The dataset type hierarchy was left unchanged.'
);
const CATEGORY_MISSING_NAME_WARNING = (
  'Some COCO categories have no non-empty string name. Those positional category slots were '
  + 'ignored when importing classifications and hierarchy edges.'
);
const SUPERCATEGORY_INVALID_WARNING = (
  'The category hierarchy in the COCO file could not be applied: {reason}. '
  + 'Annotations were imported without changing the dataset type hierarchy.'
);

function hasDuplicateCategoryNames(names: readonly (string | undefined)[]): boolean {
  const named = names.filter((name): name is string => typeof name === 'string' && name.length > 0);
  return new Set(named).size !== named.length;
}

function parentFromCategory(category: CocoCategory): string | undefined {
  if (typeof category.supercategory === 'string' && category.supercategory) {
    return category.supercategory;
  }
  if (Array.isArray(category.parents) && category.parents.length === 1) {
    const [candidate] = category.parents;
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return undefined;
}

function invalidCocoHierarchyMessage(reason: string): string {
  return SUPERCATEGORY_INVALID_WARNING.replace('{reason}', () => reason);
}

function confidencePairsFromProb(
  prob: unknown,
  orderedNames: readonly (string | undefined)[],
): [string, number][] | null {
  if (!Array.isArray(prob) || prob.length !== orderedNames.length) {
    return null;
  }
  const pairs: [string, number][] = [];
  prob.forEach((value, index) => {
    const name = orderedNames[index];
    if (typeof name !== 'string' || !name || typeof value !== 'number' || !Number.isFinite(value)) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, value));
    if (clamped > PROB_EPSILON) {
      pairs.push([name, clamped]);
    }
  });
  pairs.sort((left, right) => right[1] - left[1]);
  return pairs.length ? pairs.slice(0, PROB_TOP_K) : null;
}

function confidencePairsFromDiveExtension(value: unknown): [string, number][] | undefined {
  if (!Array.isArray(value) || !value.length) {
    return undefined;
  }
  const pairs: [string, number][] = [];
  const names = new Set<string>();
  const valid = value.every((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2
      || typeof pair[0] !== 'string' || !pair[0]
      || typeof pair[1] !== 'number' || !Number.isFinite(pair[1])
      || pair[1] < 0 || pair[1] > 1 || names.has(pair[0])) {
      return false;
    }
    names.add(pair[0]);
    pairs.push([pair[0], pair[1]]);
    return true;
  });
  return valid ? pairs : undefined;
}

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
  prob?: unknown;
  dive_confidence_pairs?: unknown;
  /**
   * COCO `iscrowd` flag (0 or 1). In the COCO spec, 0 means a single instance with
   * polygon `segmentation` ([[x1, y1, ...]]); 1 means a crowd region whose
   * `segmentation` is run-length encoded (RLE) as an object (e.g. { counts, size }).
   * DIVE does not import RLE masks: when `iscrowd` is truthy, or `segmentation` is
   * a dict, polygon/mask geometry is skipped (bbox and other fields still import).
   */
  iscrowd?: number;
  keypoints?: number[];
  segmentation?: number[] | number[][] | Record<string, unknown>;
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

function typeHierarchyFromCategories(
  document: CocoDocument,
): { hierarchy?: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  if (document.categories.some((category) => Array.isArray(category.parents)
    && category.parents.length > 1)) {
    warnings.push(SUPERCATEGORY_MULTI_PARENT_WARNING);
  }
  const names = document.categories.map((category) => category.name);
  if (names.some((name) => typeof name !== 'string' || !name)) {
    warnings.push(CATEGORY_MISSING_NAME_WARNING);
  }
  if (hasDuplicateCategoryNames(names)) {
    warnings.push(SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING);
    return { warnings };
  }
  const hierarchy: Record<string, string> = {};
  document.categories.forEach((category) => {
    const { name } = category;
    const parent = parentFromCategory(category);
    if (typeof name === 'string' && name && parent && name !== parent) {
      hierarchy[name] = parent;
    }
  });
  return Object.keys(hierarchy).length ? { hierarchy, warnings } : { warnings };
}

function imageFrameMap(document: CocoDocument): Record<number, number> {
  const sorted = [...document.images].sort(
    (a, b) => strNumericCompare(a.file_name, b.file_name),
  );
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
  const orderedCategoryNames = parsed.categories.map((category) => category.name);
  const duplicateCategoryNames = hasDuplicateCategoryNames(orderedCategoryNames);
  const frameByImageId = imageFrameMap(parsed);
  const tracks: AnnotationSchema['tracks'] = {};
  const classificationSourceByTrack = new Map<number, { frame: number; annotationId: number }>();
  let skippedRleMasks = false;
  let probLengthMismatch = false;
  let probIgnoredForDuplicates = false;
  let diveConfidencePairsInvalid = false;

  validateAnnotationBounds(parsed.annotations);

  parsed.annotations.forEach((annotation) => {
    const frame = frameByImageId[annotation.image_id];
    if (frame === undefined) return;
    const [x, y, w, h] = resolveCocoBbox(annotation);
    const bounds: [number, number, number, number] = [x, y, x + w, y + h];
    const trackId = annotation.track_id ?? annotation.id;
    const category = categoriesById[annotation.category_id];
    const categoryName = category?.name || 'unknown';
    let confidencePairs: [string, number][] = [[categoryName, annotation.score ?? 1.0]];
    const hasDiveConfidencePairs = Object.prototype.hasOwnProperty.call(
      annotation,
      'dive_confidence_pairs',
    );
    const exactPairs = confidencePairsFromDiveExtension(annotation.dive_confidence_pairs);
    if (exactPairs !== undefined) {
      confidencePairs = exactPairs;
    } else {
      if (hasDiveConfidencePairs) {
        diveConfidencePairsInvalid = true;
      }
      if (Array.isArray(annotation.prob)) {
        if (duplicateCategoryNames) {
          probIgnoredForDuplicates = true;
        } else {
          const probPairs = confidencePairsFromProb(annotation.prob, orderedCategoryNames);
          if (probPairs === null && annotation.prob.length !== orderedCategoryNames.length) {
            probLengthMismatch = true;
          } else if (probPairs) {
            confidencePairs = probPairs;
          }
        }
      }
    }
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
    const classificationSource = classificationSourceByTrack.get(trackId);
    // Classification is track-level. Prefer the temporal endpoint; ties use the intrinsic
    // annotation id, so the result does not depend on the order records appear in the file.
    if (classificationSource === undefined
      || frame > classificationSource.frame
      || (frame === classificationSource.frame && annotation.id > classificationSource.annotationId)) {
      track.confidencePairs = confidencePairs;
      classificationSourceByTrack.set(trackId, { frame, annotationId: annotation.id });
    }
  });

  const annotations: AnnotationSchema = { version: 2, tracks, groups: {} };
  const processed = processTrackAttributes(Object.values(annotations.tracks));
  const warnings: string[] = [];
  if (skippedRleMasks) warnings.push(RLE_SEGMENTATION_WARNING);
  if (probLengthMismatch) warnings.push(PROB_LENGTH_MISMATCH_WARNING);
  if (probIgnoredForDuplicates) warnings.push(PROB_DUPLICATE_CATEGORY_WARNING);
  if (diveConfidencePairsInvalid) warnings.push(DIVE_CONFIDENCE_PAIRS_INVALID_WARNING);
  const meta: Record<string, unknown> = { attributes: processed.attributes };
  // Restore the per-dataset station metadata namespaced under `info.dive_dataset_info`; the
  // caller merges it into the dataset's metadata. Omitted when absent/empty.
  const { dive_dataset_info: datasetInfo } = parsed.info ?? {};
  if (typeof datasetInfo === 'object' && !isEmpty(datasetInfo)) {
    meta.datasetInfo = datasetInfo;
  }
  return [annotations, meta, warnings];
}

function frameNameForExport(frame: number, meta: JsonConfig): string {
  if (meta.type === 'image-sequence') {
    return meta.originalImageFiles[frame] || `frame_${frame.toString().padStart(6, '0')}.jpg`;
  }
  return `frame_${frame.toString().padStart(6, '0')}.jpg`;
}

async function serializeFile(
  path: string,
  data: AnnotationSchema,
  meta: JsonConfig,
  typeFilter = new Set<string>(),
  options = {
    excludeBelowThreshold: false,
  },
) {
  const images = new Map<number, CocoImage>();
  const annotations: CocoAnnotation[] = [];
  let annotationId = 1;
  const thresholds = meta.confidenceFilters || {};
  const defaultThreshold = thresholds.default ?? 0;
  const pairsByTrack = new Map<number, [string, number][]>();
  const categoryNames: string[] = [];
  const addCategoryName = (name: string) => {
    if (!categoryNames.includes(name)) {
      categoryNames.push(name);
    }
  };
  const hierarchy = meta.typeHierarchy || {};

  Object.values(data.tracks).forEach((track) => {
    const filteredPairs = track.confidencePairs.filter(([name, score]) => {
      const keepType = typeFilter.size === 0 || typeFilter.has(name);
      const keepThreshold = !options.excludeBelowThreshold || score >= (thresholds[name] ?? defaultThreshold);
      return keepType && keepThreshold;
    });
    if (!filteredPairs.length) return;
    const pairs = filteredPairs.map(([name, score]) => [name, score] as [string, number]);
    pairsByTrack.set(track.id, pairs);
    pairs.forEach(([name]) => addCategoryName(name));
  });

  Object.keys(hierarchy).sort().forEach(addCategoryName);
  Array.from(new Set(Object.values(hierarchy))).sort().forEach(addCategoryName);
  const categories = new Map(categoryNames.map((name, index) => [name, index + 1]));

  Object.values(data.tracks).forEach((track) => {
    const pairs = pairsByTrack.get(track.id);
    if (!pairs) return;
    const [className, score] = [...pairs].sort((a, b) => b[1] - a[1])[0];
    const categoryId = categories.get(className) as number;
    const probabilityByName = new Map(pairs);
    const prob = categoryNames.map((name) => probabilityByName.get(name) || 0);

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
        prob,
        dive_confidence_pairs: pairs.map(([name, confidence]) => [name, confidence]),
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
    ...(hierarchy[name] ? { supercategory: hierarchy[name] } : {}),
  }));
  // datasetInfo rides in the `info` block + dive_extensions; omitted entirely when empty.
  const datasetInfo = meta.datasetInfo && !isEmpty(meta.datasetInfo) ? meta.datasetInfo : undefined;
  const info: CocoDocument['info'] = {
    description: `DIVE export for ${meta.name}`,
    dive_extensions: [
      'dive_detection_attributes',
      'dive_track_attributes',
      'dive_notes',
      'dive_confidence_pairs',
      ...(datasetInfo ? ['dive_dataset_info'] : []),
    ],
    ...(datasetInfo ? { dive_dataset_info: datasetInfo } : {}),
  };
  const output: CocoDocument = {
    info,
    images: Array.from(images.values()),
    annotations,
    categories: categoryDocs,
  };
  await fs.writeJSON(path, output, { spaces: 2 });
  return path;
}

export {
  CATEGORY_MISSING_NAME_WARNING,
  DIVE_CONFIDENCE_PAIRS_INVALID_WARNING,
  PROB_DUPLICATE_CATEGORY_WARNING,
  PROB_LENGTH_MISMATCH_WARNING,
  SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING,
  SUPERCATEGORY_MULTI_PARENT_WARNING,
  invalidCocoHierarchyMessage,
  isCocoJson,
  parseFile,
  serializeFile,
  typeHierarchyFromCategories,
};
