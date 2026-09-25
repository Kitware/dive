/**
 * Web point segmentation backed by the server's interactive service: the
 * recipe's clicks become `dive_interactive` requests, and a finished mask is
 * carried to the other stereo camera by the service's own `stereo_segment`.
 */
import type { SegmentationPolygon, SegmentationPredictRequest } from 'dive-common/apispec';
import { SegmentationPolygonKey } from 'dive-common/recipes/segmentationpointclick';
import {
  componentsBounds, isSegmentationPolygonKey, segmentationPolygonFeatures,
} from 'dive-common/recipes/segmentationPolygons';
import { clientSettings } from 'dive-common/store/settings';
import type { StereoAnnotationCompleteParams } from 'dive-common/use/useModeManager';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import type Track from 'vue-media-annotator/track';
import {
  interactiveSegmentationPredict, interactiveStereoSegment,
} from 'platform/web-girder/api/interactive.service';
import { fromViewer } from 'platform/web-girder/useStereoOnnxWeb';

interface ServerSegmentationOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getViewer: () => any;
  getDatasetId: () => string;
  /** Whether the server can take requests right now, refreshed by the host. */
  isEnabled: () => boolean;
  /** Why it cannot, shown when the user reaches for the tool anyway. */
  disabledMessage: () => string;
  refreshMeasurement: (trackId: number, frameNum: number) => Promise<unknown>;
  onError: (message: string) => void;
}

export default function useServerSegmentation(opts: ServerSegmentationOptions) {
  function trackAt(camera: string, trackId: number): Track | undefined {
    return opts.getViewer()?.cameraStore?.getPossibleTrack(trackId, camera);
  }

  function polygonsAt(camera: string, trackId: number, frameNum: number): SegmentationPolygon[] {
    return (trackAt(camera, trackId)?.getFeature(frameNum)[0]?.geometry?.features ?? [])
      .filter((f): f is GeoJSON.Feature<GeoJSON.Polygon> => f.geometry.type === 'Polygon')
      .map((f) => ({
        exterior: f.geometry.coordinates[0] as [number, number][],
        holes: f.geometry.coordinates.slice(1) as [number, number][][],
      }));
  }

  /** Hook the shared recipe up once the Viewer is mounted. */
  function initialize(): boolean {
    const viewer = opts.getViewer();
    if (!viewer?.segmentationRecipe) return false;
    viewer.segmentationRecipe.initialize({
      predictFn: (request: SegmentationPredictRequest, frameNum: number) => interactiveSegmentationPredict({
        datasetId: opts.getDatasetId(),
        // The recipe passes getImagePath's value back: the camera name here.
        camera: request.imagePath || undefined,
        frame: frameNum,
        points: request.points,
        pointLabels: request.pointLabels,
        box: request.box,
        line: request.line,
        multimaskOutput: request.multimaskOutput,
      }),
      getImagePath: () => fromViewer<string>(opts.getViewer()?.selectedCamera) ?? '',
      initializeServiceFn: async () => {
        if (!opts.isEnabled()) {
          throw new Error(opts.disabledMessage() || 'Interactive segmentation is not available right now.');
        }
      },
    });
    return true;
  }

  /**
   * A click-segmented mask on one camera, carried to the other by the
   * service. Returns false when the event is not one this handles, so the
   * host can pass it to the geometry transfer instead.
   */
  async function handleStereoSegmentation(params: StereoAnnotationCompleteParams): Promise<boolean> {
    if (params.type !== 'segmentation') return false;
    const viewer = opts.getViewer();
    const cameras: string[] = fromViewer<string[]>(viewer?.multiCamList) ?? [];
    const otherCamera = cameras.find((c) => c !== params.camera);
    if (!otherCamera || !clientSettings.stereoSettings.autoComputeOtherCamera) return true;
    if (!opts.isEnabled()) return true;
    const polygons = polygonsAt(params.camera, params.trackId, params.frameNum);
    if (!polygons.length) return true;
    try {
      const response = await interactiveStereoSegment({
        datasetId: opts.getDatasetId(),
        frame: params.frameNum,
        sourceCamera: params.camera,
        points: params.points,
        pointLabels: params.labels,
        polygon: polygons[0].exterior,
        polygons,
        method: clientSettings.stereoSettings.matchMethod,
      });
      if (!response.success) throw new Error(response.error || 'No mask found on the other camera.');
      let mask = response.polygons ?? [];
      if (!mask.length && response.polygon) mask = [{ exterior: response.polygon, holes: [] }];
      if (!mask.length) throw new Error('No mask found on the other camera.');
      if (viewer !== opts.getViewer()) return true;
      let track = trackAt(otherCamera, params.trackId);
      const source = trackAt(params.camera, params.trackId);
      if (!track) {
        track = viewer.cameraStore.camMap.value.get(otherCamera)?.trackStore
          .add(params.frameNum, source?.confidencePairs?.[0]?.[0] || 'unknown', undefined, params.trackId);
        if (track && source) track.set = source.set;
      }
      if (!track) throw new Error('Could not create the other-camera detection.');
      const bounds = response.bounds ?? componentsBounds(mask);
      track.setFeature({
        frame: params.frameNum, keyframe: true, interpolate: false, bounds,
      });
      const geometries = segmentationPolygonFeatures(mask, SegmentationPolygonKey);
      const keys = new Set(geometries.map((g) => g.properties?.key));
      track.getPolygonFeatures(params.frameNum).forEach((p) => {
        if (isSegmentationPolygonKey(p.key, SegmentationPolygonKey) && !keys.has(p.key)) {
          track!.removeFeatureGeometry(params.frameNum, { key: p.key, type: 'Polygon' });
        }
      });
      track.setFeature({ frame: params.frameNum, keyframe: true }, geometries);
      if (response.generateLine && response.lineOther) {
        track.setFeature({ frame: params.frameNum, keyframe: true, bounds }, headTailFeatures(response.lineOther));
        if (response.lineSource && source) {
          source.setFeature({ frame: params.frameNum, keyframe: true }, headTailFeatures(response.lineSource));
        }
      }
      await opts.refreshMeasurement(params.trackId, params.frameNum);
    } catch (err) {
      opts.onError(`Stereo segmentation: ${(err as Error).message}`);
    }
    return true;
  }

  return { initialize, handleStereoSegmentation };
}
