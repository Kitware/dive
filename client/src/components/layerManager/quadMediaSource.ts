import type { CameraImage } from '../../layers/AlignedImageLayer';

/** GeoJS viewer with a layers() accessor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoViewer = any;

/** GeoJS feature layer with a features() accessor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoLayer = any;

function quadDatumFromLayer(layer: GeoLayer): GeoLayer | undefined {
  if (typeof layer.features !== 'function') {
    return undefined;
  }
  return layer.features()
    .map((feature: GeoLayer) => {
      const data = typeof feature.data === 'function' ? feature.data() : undefined;
      return Array.isArray(data) ? data[0] : undefined;
    })
    .find((datum: GeoLayer) => datum?.image || datum?.video);
}

/** True when a layer contains a quad datum with an image or video texture. */
export function layerHasQuadMedia(layer: GeoLayer): boolean {
  return quadDatumFromLayer(layer) !== undefined;
}

/**
 * Scan a GeoJS viewer's feature layers for the first quad datum carrying an
 * `image` or `video` texture source (ImageAnnotator / VideoAnnotator).
 * Returns null for annotators without one (e.g. tiled large-image datasets).
 */
export function findQuadMediaSource(
  viewer: GeoViewer | null | undefined,
  excludeLayer?: GeoLayer,
): CameraImage | null {
  if (!viewer || typeof viewer.layers !== 'function') {
    return null;
  }
  const layerList = viewer.layers();
  for (let i = 0; i < layerList.length; i += 1) {
    const layer = layerList[i];
    if (layer !== excludeLayer) {
      const datum = quadDatumFromLayer(layer);
      if (datum) {
        if (datum.image) {
          const image = datum.image as HTMLImageElement;
          return {
            source: image,
            kind: 'image' as const,
            width: image.naturalWidth,
            height: image.naturalHeight,
          };
        }
        const video = datum.video as HTMLVideoElement;
        return {
          source: video,
          kind: 'video' as const,
          width: video.videoWidth,
          height: video.videoHeight,
        };
      }
    }
  }
  return null;
}

/**
 * Find the first layer (optionally excluding one) with quad image/video media.
 */
export function findQuadMediaLayer(
  viewer: GeoViewer | null | undefined,
  excludeLayer?: GeoLayer,
): GeoLayer | null {
  if (!viewer || typeof viewer.layers !== 'function') {
    return null;
  }
  const layerList = viewer.layers();
  for (let i = 0; i < layerList.length; i += 1) {
    const layer = layerList[i];
    if (layer !== excludeLayer && layerHasQuadMedia(layer)) {
      return layer;
    }
  }
  return null;
}

/**
 * Resolve a camera's currently displayed frame image/video via its GeoJS viewer.
 * Swallows getController errors (e.g. after a dataset reload clears controllers).
 */
export function getCameraQuadMedia(
  getController: (camera: string) => { geoViewerRef?: { value?: GeoViewer } } | undefined,
  camera: string,
): CameraImage | null {
  try {
    return findQuadMediaSource(getController(camera)?.geoViewerRef?.value);
  } catch {
    return null;
  }
}
