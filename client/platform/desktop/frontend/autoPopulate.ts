import type Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import { SegmentationPolygonKey } from 'dive-common/recipes/segmentationpointclick';
import type { NewAnnotationGeometryParams } from 'dive-common/use/useModeManager';
import {
  autoPopulatePrompt, autoPopulateTarget, closedRing, orientLineLike, polygonBounds,
} from 'dive-common/use/autoPopulate';
import type {
  SegmentationPredictRequest, SegmentationPredictResponse, SegmentationPolygonKeypointsResponse,
} from '../backend/native/segmentation';

interface AutoPopulateServices {
  getTrack(): Track | undefined;
  getMedia(): Promise<{ imagePath: string; frameTime?: number }>;
  ensureReady(): Promise<void>;
  predict(request: SegmentationPredictRequest): Promise<SegmentationPredictResponse>;
  keypoints(polygon: [number, number][]): Promise<SegmentationPolygonKeypointsResponse>;
}

/** Apply independent mask/point results without losing a valid mask if points fail. */
export default async function populateAnnotation(
  params: NewAnnotationGeometryParams,
  options: { mask: boolean; points: boolean; orientLike?: [number, number][] | null },
  services: AutoPopulateServices,
): Promise<'applied' | 'changed'> {
  const currentTarget = autoPopulateTarget(services.getTrack, params.frameNum);
  if (!currentTarget()) return 'changed';
  const media = await services.getMedia();
  if (!media.imagePath) throw new Error('The image for this annotation could not be found.');
  await services.ensureReady();
  if (!currentTarget()) return 'changed';
  const prompt = autoPopulatePrompt(params);
  const response = await services.predict({
    ...media,
    points: prompt.points,
    pointLabels: prompt.labels,
    multimaskOutput: params.source === 'box',
    line: params.source === 'line' ? params.line : undefined,
  });
  if (!response.success) throw new Error(response.error || 'Segmentation failed.');
  if (!response.polygon || response.polygon.length < 3) {
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
    track.setFeature({ frame: params.frameNum, keyframe: true }, [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closedRing(response.polygon)] },
      properties: { key: SegmentationPolygonKey },
    }]);
  }
  if (options.points && params.source === 'line') {
    track.setFeature({
      frame: params.frameNum,
      keyframe: true,
      bounds: response.bounds ?? polygonBounds(response.polygon),
    });
  }
  if (options.points && params.source === 'box' && !hasLine) {
    // Snapshot again after our own mask write, before awaiting the next service call.
    const pointsTarget = autoPopulateTarget(services.getTrack, params.frameNum);
    try {
      const keypoints = await services.keypoints(response.polygon);
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
