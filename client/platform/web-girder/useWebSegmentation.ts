import { watch, onBeforeUnmount, ref } from 'vue';
import { cloneDeep } from 'lodash';
import type Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import type { Feature } from 'vue-media-annotator/track';
import { clientSettings } from 'dive-common/store/settings';
import type { SegmentationPolygon, SegmentationPredictRequest } from 'dive-common/apispec';
import type {
  NewAnnotationGeometryParams, StereoAnnotationCompleteParams,
  StereoAnnotationResetParams, StereoSegmentationFinalizeParams,
} from 'dive-common/use/useModeManager';
import {
  componentsBounds, segmentationComponents, segmentationPolygonFeatures, isSegmentationPolygonKey,
} from 'dive-common/recipes/segmentationPolygons';
import { SegmentationPolygonKey } from 'dive-common/recipes/segmentationpointclick';
import populateAnnotation from 'dive-common/use/populateAnnotation';
import { autoPopulateTarget } from 'dive-common/use/autoPopulate';
import SamOnnx from 'dive-common/use/segmentation/SamOnnx';
import { maskSeeds, maskKeypoints } from 'dive-common/use/segmentation/maskGeometry';
import type { RgbaImage } from 'dive-common/use/stereo/image';
import { STEREO_USER_LINE_ATTR } from 'dive-common/use/stereo/useStereoOnnxTransfer';
import type useStereoOnnxWeb from './useStereoOnnxWeb';

type Point = [number, number];
type Stereo = ReturnType<typeof useStereoOnnxWeb>;
type Identity = { camera: string; trackId: number; frameNum: number };
type Preview = { camera: string; track?: Track; original?: Feature; written?: string };
const keyOf = (p: Identity) => `${p.camera}:${p.trackId}:${p.frameNum}`;
const signature = (track: Track | undefined, frame: number) => {
  const f = track?.getFeature(frame)[0];
  return JSON.stringify(f ? [f.bounds, f.geometry, f.head, f.tail] : null);
};

/** Browser implementations of the native segmentation/auto-populate services. */
export default function useWebSegmentation(
  // Viewer exposes refs as component properties, unwrapped by Vue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getViewer: () => any,
  stereo: Stereo,
  onError: (message: string) => void,
) {
  const status = ref<string | null>(null);
  const sam = new SamOnnx((message) => { status.value = message; });
  const jobs = new Map<string, Promise<SegmentationPolygon[] | null>>();
  const versions = new Map<string, number>();
  const previews = new Map<string, Preview>();
  const ownLines = new Map<string, Point[]>();
  const active = new Map<string, number>();
  const finalized = new Map<string, number>();
  const generated = new Map<string, string>();
  let epoch = 0;
  const settings = () => clientSettings.trackSettings.newTrackSettings;
  const trackAt = (p: Identity): Track | undefined => getViewer()?.cameraStore?.getPossibleTrack(p.trackId, p.camera);

  async function predict(camera: string, frame: number, request: SegmentationPredictRequest, captured?: Promise<RgbaImage | null>) {
    const viewer = getViewer();
    const generation = epoch;
    const image = await (captured ?? stereo.getFrame(camera, frame));
    if (!image) throw new Error('The image or video frame is not ready for segmentation.');
    if (viewer !== getViewer() || epoch !== generation) throw new Error('Segmentation request was cancelled.');
    const result = await sam.predict(`${viewer.id}:${camera}:${frame}`, image, request);
    if (viewer !== getViewer() || epoch !== generation) throw new Error('Segmentation request was cancelled.');
    return result;
  }

  function polygonsAt(p: Identity): SegmentationPolygon[] {
    return (trackAt(p)?.getFeature(p.frameNum)[0]?.geometry?.features ?? [])
      .filter((f): f is GeoJSON.Feature<GeoJSON.Polygon> => f.geometry.type === 'Polygon')
      .map((f) => ({ exterior: f.geometry.coordinates[0] as Point[], holes: f.geometry.coordinates.slice(1) as Point[][] }));
  }

  function lineAt(p: Identity): Point[] | null {
    const feature = trackAt(p)?.getFeature(p.frameNum)[0];
    return feature?.head && feature.tail ? [feature.head, feature.tail] : null;
  }

  async function populate(params: NewAnnotationGeometryParams, knownMask?: SegmentationPolygon[], orientLike?: Point[] | null) {
    const viewer = getViewer(); const generation = epoch;
    // Capture before model loading or auto-advance changes a video frame.
    const captured = params.source === 'mask' || knownMask ? undefined : stereo.getFrame(params.camera, params.frameNum);
    let polygons: SegmentationPolygon[] = [];
    const result = await populateAnnotation(params, {
      mask: settings().autoPopulateMask,
      points: settings().autoPopulatePoints,
      ownLine: ownLines.get(keyOf(params)),
      orientLike,
      fitBoxToMask: !!knownMask,
      knownMask,
      onMask: (mask) => { polygons = mask; },
      onLine: (line) => ownLines.set(keyOf(params), line),
    }, {
      getTrack: () => (getViewer() === viewer && epoch === generation ? trackAt(params) : undefined),
      getMedia: async () => ({ imagePath: params.camera }),
      ensureReady: async () => {},
      predict: (request) => predict(params.camera, params.frameNum, params.source === 'box' ? {
        ...request,
        points: [...request.points, [params.bounds[0], params.bounds[1]], [params.bounds[2], params.bounds[3]]],
        pointLabels: [...request.pointLabels, 2, 3],
      } : request, captured),
      keypoints: async (polygon, components) => maskKeypoints(components ?? [{ exterior: polygon, holes: [] }]),
    });
    return result === 'changed' ? null : polygons;
  }

  function handleNewAnnotationGeometry(params: NewAnnotationGeometryParams) {
    if ((!settings().autoPopulateMask && !settings().autoPopulatePoints)
      || (params.source === 'mask' && !settings().autoPopulatePoints)) return;
    const key = keyOf(params);
    const job = populate(params).catch((err) => {
      onError(`Auto-populate: ${(err as Error).message}`);
      return [];
    }).finally(() => {
      if (jobs.get(key) === job) jobs.delete(key);
    });
    jobs.set(key, job);
  }

  async function handleStereoAnnotationComplete(params: StereoAnnotationCompleteParams) {
    if (params.type === 'line') trackAt(params)?.setFeatureAttribute(params.frameNum, STEREO_USER_LINE_ATTR, true);
    const key = keyOf(params);
    const version = (versions.get(key) ?? 0) + 1;
    versions.set(key, version);
    const viewer = getViewer(); const generation = epoch;
    const valid = () => getViewer() === viewer && generation === epoch && versions.get(key) === version;
    const sourceJob = jobs.get(key);
    active.set(key, (active.get(key) ?? 0) + 1);
    const otherCamera: string | undefined = viewer.multiCamList.find((c: string) => c !== params.camera);
    const capturedOther = otherCamera && (params.type === 'segmentation' || sourceJob)
      ? stereo.getFrame(otherCamera, params.frameNum) : undefined;
    try {
      const sourceMask = sourceJob ? await sourceJob : [];
      if (!valid() || sourceMask === null) return;
      const camera: string | undefined = viewer.multiCamList.find((c: string) => c !== params.camera);
      if (!camera || !clientSettings.stereoSettings.autoComputeOtherCamera) {
        if (params.type !== 'segmentation') await stereo.handleStereoAnnotationComplete(params);
        return;
      }
      const useMask = params.type === 'segmentation' || (sourceMask.length > 0 && ['box', 'line'].includes(params.type));
      if (!useMask) {
        const target = { ...params, camera };
        const targetKey = keyOf(target);
        const canOwn = !trackAt(target)?.getFeature(params.frameNum)[0]
          || generated.get(targetKey) === signature(trackAt(target), params.frameNum);
        const result = await stereo.handleStereoAnnotationComplete(params);
        if (result === 'transferred' && canOwn && valid()) generated.set(targetKey, signature(trackAt(target), params.frameNum));
        return;
      }
      const mapped = { ...params, camera };
      const prior = trackAt(mapped);
      const priorFeature = prior?.getFeature(params.frameNum)[0];
      let preview = previews.get(key);
      if (priorFeature && (priorFeature.attributes?.[STEREO_USER_LINE_ATTR] === true
        || (preview?.written !== signature(prior, params.frameNum)
          && generated.get(keyOf(mapped)) !== signature(prior, params.frameNum)))) {
        // A user-authored counterpart is never replaced by an automatic mask.
        await stereo.refreshMeasurement(params.trackId, params.frameNum);
        return;
      }
      if (!preview) {
        preview = { camera, track: prior, original: priorFeature ? cloneDeep(priorFeature) : undefined };
        previews.set(key, preview);
      }
      const sourceUnchanged = autoPopulateTarget(() => trackAt(params), params.frameNum);
      const targetBefore = signature(prior, params.frameNum);
      const components = params.type === 'segmentation' ? polygonsAt(params) : sourceMask;
      const points = params.type === 'segmentation' ? params.points : maskSeeds(components);
      const labels = params.type === 'segmentation' ? params.labels : points.map(() => 1);
      if (!points.length) throw new Error('No foreground prompts inside the source mask.');
      const warped = await stereo.warpPoints(points, params.camera, params.frameNum);
      // Never turn a failed negative prompt into an unintended positive mask.
      if (warped.length !== points.length || warped.some((p) => p === null)) {
        throw new Error('No confident stereo match for the segmentation prompts.');
      }
      if (!valid() || !sourceUnchanged()) return;
      const warpedLine = params.type === 'line' ? await stereo.warpPoints(params.line, params.camera, params.frameNum) : null;
      if (params.type === 'line' && (!warpedLine || warpedLine.length !== params.line.length || warpedLine.some((p) => p === null))) {
        throw new Error('No confident stereo match for the line endpoints.');
      }
      const response = await predict(camera, params.frameNum, {
        imagePath: camera, points: warped as Point[], pointLabels: labels,
      }, capturedOther);
      const targetMask = segmentationComponents(response);
      if (!response.success || !targetMask.length) throw new Error(response.error || 'No mask found on the other camera.');
      if (!valid() || !sourceUnchanged() || trackAt(mapped) !== prior
        || signature(prior, params.frameNum) !== targetBefore) return;
      const sourceBounds = componentsBounds(components);
      const bounds = componentsBounds(targetMask);
      const extent = (b: number[]) => Math.max(b[2] - b[0], b[3] - b[1]);
      const ratio = extent(bounds) / extent(sourceBounds);
      if (ratio < 0.25 || ratio > 4) throw new Error('The other-camera mask is out of scale with the source mask.');
      let track = prior;
      if (!track) {
        const source = trackAt(params);
        track = viewer.cameraStore.camMap.value.get(camera)?.trackStore.add(params.frameNum, source?.confidencePairs?.[0]?.[0] || 'unknown', undefined, params.trackId);
        if (track && source) track.set = source.set;
      }
      if (!track) throw new Error('Could not create the other-camera detection.');
      // Record ownership before awaiting line population/measurement.
      track.setFeature({
        frame: params.frameNum, keyframe: true, interpolate: false, bounds,
      });
      const geometries = segmentationPolygonFeatures(targetMask, SegmentationPolygonKey);
      if (params.type === 'segmentation' || settings().autoPopulateMask) {
        const keys = new Set(geometries.map((g) => g.properties?.key));
        track.getPolygonFeatures(params.frameNum).forEach((p) => {
          if (isSegmentationPolygonKey(p.key, SegmentationPolygonKey) && !keys.has(p.key)) {
            track!.removeFeatureGeometry(params.frameNum, { key: p.key, type: 'Polygon' });
          }
        });
        track.setFeature({ frame: params.frameNum, keyframe: true }, geometries);
      }
      preview.written = signature(track, params.frameNum);
      if (settings().autoPopulatePoints || params.type === 'line') {
        // Preserve a drawn line through correspondence; generated lines use
        // the same hull-extremes geometry method as native VIAME.
        if (params.type === 'line') {
          const features = headTailFeatures(warpedLine as Point[]).map((g) => ({
            ...g,
            properties: g.geometry.type === 'Point'
              ? { ...g.properties, stereoSource: params.camera, stereoKey: g.properties?.key } : g.properties,
          }));
          track.setFeature({ frame: params.frameNum, keyframe: true, bounds }, features);
        } else {
          const populated = await populate({ ...mapped, source: 'mask', polygons: targetMask }, targetMask, lineAt(params));
          if (populated === null) return;
        }
      }
      preview.written = signature(track, params.frameNum);
      if (valid()) await stereo.refreshMeasurement(params.trackId, params.frameNum);
      if (params.type !== 'segmentation' || finalized.get(key) === version) previews.delete(key);
    } catch (err) {
      if (valid()) onError(`Stereo segmentation: ${(err as Error).message}`);
    } finally {
      active.set(key, Math.max(0, (active.get(key) ?? 1) - 1));
      if (!active.get(key)) { active.delete(key); finalized.delete(key); }
      if (jobs.get(key) === sourceJob) jobs.delete(key);
    }
  }

  function handleStereoAnnotationReset(params: StereoAnnotationResetParams) {
    const source = { ...params, camera: params.sourceCamera }; const key = keyOf(source);
    versions.set(key, (versions.get(key) ?? 0) + 1);
    const preview = previews.get(key);
    if (preview) {
      const target = trackAt({ ...source, camera: preview.camera });
      if (preview.written === signature(target, params.frameNum)) {
        if (target && !preview.track && target.featureIndex.length === 1) {
          getViewer().cameraStore.camMap.value.get(preview.camera)?.trackStore.remove(params.trackId);
        } else target?.deleteFeature(params.frameNum);
        if (preview.original) target?.setFeature(cloneDeep(preview.original), cloneDeep(preview.original.geometry?.features ?? []));
      }
      previews.delete(key);
    }
    ownLines.delete(key);
    if (preview) ownLines.delete(keyOf({ ...source, camera: preview.camera }));
    jobs.delete(key);
  }

  function handleStereoSegmentationFinalize(params?: StereoSegmentationFinalizeParams) {
    new Set([...previews.keys(), ...active.keys()]).forEach((key) => {
      if (!params || params.frameNums.some((f) => key.endsWith(`:${params.trackId}:${f}`))) {
        if (active.has(key)) finalized.set(key, versions.get(key) ?? 0);
        else previews.delete(key);
      }
    });
  }

  watch(() => [getViewer()?.segmentationRecipe, getViewer()?.progress?.loaded, settings().segmentationModel], (_current, previous) => {
    const viewer = getViewer();
    if (!viewer?.segmentationRecipe || !viewer?.progress?.loaded) return;
    if (viewer.datasetType === 'large-image') {
      viewer.segmentationRecipe.toggleable.value = false;
      return;
    }
    if (previous?.[0] === viewer.segmentationRecipe) viewer.handler?.segmentationFinalizePending?.();
    epoch += 1;
    jobs.clear(); versions.clear(); previews.clear(); ownLines.clear(); generated.clear(); finalized.clear();
    sam.dispose().catch(() => {});
    sam.setModel(settings().segmentationModel === 'sam3' ? 'sam3' : 'sam2').catch(onError);
    viewer.segmentationRecipe.initialize({
      initializeServiceFn: () => sam.ready(),
      getImagePath: () => viewer.selectedCamera,
      predictFn: (request: SegmentationPredictRequest, frame: number) => predict(request.imagePath, frame, request),
    });
  }, { immediate: true });

  onBeforeUnmount(() => {
    epoch += 1;
    sam.dispose().catch(() => {});
    jobs.clear(); previews.clear();
  });

  return {
    status,
    handleNewAnnotationGeometry,
    handleStereoAnnotationComplete,
    handleStereoAnnotationReset,
    handleStereoSegmentationFinalize,
  };
}
