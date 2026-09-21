import type Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import { SegmentationPolygonKey } from 'dive-common/recipes/segmentationpointclick';
import type { NewAnnotationGeometryParams } from 'dive-common/use/useModeManager';
import {
  autoPopulatePrompt, autoPopulateTarget, boundsIoU, closedRing, orientLineLike, polygonBounds,
  MAPPED_BOX_MIN_IOU,
} from 'dive-common/use/autoPopulate';
import type { SegmentationPolygon, SegmentationPredictRequest, SegmentationPredictResponse } from 'dive-common/apispec';
import type { SegmentationPolygonKeypointsResponse } from '../backend/native/segmentation';

interface AutoPopulateServices {
  getTrack(): Track | undefined;
  getMedia(): Promise<{ imagePath: string; frameTime?: number }>;
  ensureReady(): Promise<void>;
  predict(request: SegmentationPredictRequest): Promise<SegmentationPredictResponse>;
  keypoints(polygon: [number, number][], polygons?: SegmentationPolygon[]): Promise<SegmentationPolygonKeypointsResponse>;
}

export interface AutoPopulateOptions {
  mask: boolean;
  points: boolean;
  orientLike?: [number, number][] | null;
  /** The box was mapped from the other stereo camera: refit it when the mask disagrees with it. */
  fitBoxToMask?: boolean;
}

async function predictMask(
  params: Exclude<NewAnnotationGeometryParams, { source: 'mask' }>,
  services: AutoPopulateServices,
): Promise<SegmentationPolygon[]> {
  const media = await services.getMedia();
  if (!media.imagePath) throw new Error('The image for this annotation could not be found.');
  const prompt = autoPopulatePrompt(params);
  const response = await services.predict({
    ...media,
    points: prompt.points,
    pointLabels: prompt.labels,
    multimaskOutput: params.source === 'box',
    line: params.source === 'line' ? params.line : undefined,
  });
  if (!response.success) throw new Error(response.error || 'Segmentation failed.');
  return response.polygons?.length
    ? response.polygons
    : [{ exterior: response.polygon ?? [], holes: [] }];
}

/** Apply independent mask/point results without losing a valid mask if points fail. */
export default async function populateAnnotation(
  params: NewAnnotationGeometryParams,
  options: AutoPopulateOptions,
  services: AutoPopulateServices,
): Promise<'applied' | 'changed'> {
  const currentTarget = autoPopulateTarget(services.getTrack, params.frameNum);
  if (!currentTarget()) return 'changed';
  await services.ensureReady();
  if (!currentTarget()) return 'changed';
  const polygons = (params.source === 'mask' ? params.polygons : await predictMask(params, services))
    .filter((polygon) => polygon.exterior.length >= 3);
  if (!polygons.length) {
    throw new Error('Segmentation returned no mask for this annotation.');
  }
  const target = currentTarget();
  if (!target) return 'changed';
  const { track, feature } = target;
  const features = feature.geometry?.features ?? [];
  const hasPolygon = features.some((f) => f.geometry.type === 'Polygon');
  const hasLine = features.some((f) => f.geometry.type === 'LineString');
  const addedMask = options.mask && !hasPolygon;
  if (addedMask) {
    track.setFeature({ frame: params.frameNum, keyframe: true }, polygons.map((polygon, index) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [closedRing(polygon.exterior), ...polygon.holes.map(closedRing)],
      },
      properties: { key: index === 0 ? SegmentationPolygonKey : `${SegmentationPolygonKey}-${index}` },
    })));
  }
  const maskBounds = polygonBounds(polygons.flatMap((polygon) => polygon.exterior));
  if (options.points && params.source === 'line') {
    track.setFeature({ frame: params.frameNum, keyframe: true, bounds: maskBounds });
  } else if (options.fitBoxToMask && params.source === 'box'
    && boundsIoU(params.bounds, maskBounds) < MAPPED_BOX_MIN_IOU) {
    track.setFeature({ frame: params.frameNum, keyframe: true, bounds: maskBounds });
  }
  if (options.points && params.source !== 'line' && !hasLine) {
    // Snapshot again after our own mask write, before awaiting the next service call.
    const pointsTarget = autoPopulateTarget(services.getTrack, params.frameNum);
    try {
      const keypoints = await services.keypoints(polygons[0].exterior, polygons);
      if (!keypoints.success || !keypoints.head || !keypoints.tail) {
        throw new Error(keypoints.error || 'No head/tail points were returned.');
      }
      if (!pointsTarget()) return 'changed';
      const line = orientLineLike([keypoints.head, keypoints.tail], options.orientLike ?? []);
      track.setFeature({ frame: params.frameNum, keyframe: true }, headTailFeatures(line));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${addedMask ? 'Mask added, but head/tail extraction failed' : 'Head/tail extraction failed'}: ${message}`);
    }
  }
  return 'applied';
}
