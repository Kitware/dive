import { TrackWithContext } from 'vue-media-annotator/BaseFilterControls';
import StyleManager from 'vue-media-annotator/StyleManager';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';

export function getTrackType(trackWithContext: TrackWithContext) {
  const track = trackWithContext.annotation;
  return track.getType(
    trackWithContext.context.confidencePairIndex,
  );
}

export function getTrackColor(trackWithContext: TrackWithContext, styleManager: StyleManager) {
  const trackType = getTrackType(trackWithContext);
  return vtkMath.hex2float(
    styleManager.typeStyling.value.color(trackType),
  ) as [number, number, number];
}
