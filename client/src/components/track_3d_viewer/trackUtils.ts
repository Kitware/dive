import { TrackWithContext } from 'vue-media-annotator/BaseFilterControls';
import StyleManager from 'vue-media-annotator/StyleManager';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import { Bounds3, Position } from './positions';

export interface ViewUtils {
  rerender: (resetCamera?: boolean) => void;
  /** Extent of the plotted positions, ignoring outliers; null when there are none. */
  sceneBounds: () => Bounds3 | null;
}

export interface Feature extends Position {
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
