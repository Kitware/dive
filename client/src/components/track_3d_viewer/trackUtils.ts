import { TrackWithContext } from 'vue-media-annotator/BaseFilterControls';
import StyleManager from 'vue-media-annotator/StyleManager';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';

export interface ViewUtils {
  rerender: () => void;
}

export interface Feature {
  x: number;
  y: number;
  z: number;
  frameNumber: number;
}

export type TrackType = string;

export function getTrackType(trackWithContext: TrackWithContext) {
  const track = trackWithContext.annotation;
  return track.getType(
    trackWithContext.context.confidencePairIndex,
  );
}

export function getTrackTypeColor(trackType: TrackType, styleManager: StyleManager) {
  return vtkMath.hex2float(
    styleManager.typeStyling.value.color(trackType),
  ) as [number, number, number];
}

export function getTrackColor(trackWithContext: TrackWithContext, styleManager: StyleManager) {
  const trackType = getTrackType(trackWithContext);
  return getTrackTypeColor(trackType, styleManager);
}
