import { watch, Ref } from 'vue';
import type SegmentationPointsLayer from '../../layers/AnnotationLayers/SegmentationPointsLayer';

export default function useSegmentationPointsLayer(options: {
  camera: string;
  segmentationPointsRef: Ref<{ points: [number, number][]; labels: number[]; frameNum: number }>;
  frameNumberRef: Ref<number>;
  selectedCamera: Ref<string>;
  segmentationPointsLayer: SegmentationPointsLayer;
  mapDisplayPoint: (x: number, y: number) => { x: number; y: number };
}) {
  const {
    camera,
    segmentationPointsRef,
    frameNumberRef,
    selectedCamera,
    segmentationPointsLayer,
    mapDisplayPoint,
  } = options;

  // Watch for segmentation points updates - only show points for the current
  // frame, and only on the selected camera.
  watch(
    [segmentationPointsRef, frameNumberRef, selectedCamera],
    ([newPoints, currentFrame, currentCamera]) => {
      if (newPoints.points.length > 0 && newPoints.frameNum === currentFrame
        && camera === currentCamera) {
        const displayPoints = newPoints.points.map((p): [number, number] => {
          const { x, y } = mapDisplayPoint(p[0], p[1]);
          return [x, y];
        });
        segmentationPointsLayer.updatePoints(displayPoints, newPoints.labels);
      } else {
        segmentationPointsLayer.clear();
      }
    },
    { deep: true },
  );
}
