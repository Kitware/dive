import { TrackWithContext } from 'vue-media-annotator/BaseFilterControls';
import StyleManager from 'vue-media-annotator/StyleManager';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { RGBColor } from '@kitware/vtk.js/types';
import { FrameNumber } from './TrackManager';

export interface ViewUtils {
  rerender: () => void;
  createTrackActors: (trackColor: RGBColor, features: Array<Feature>) => {
    trackActor: vtkActor;
    frameDetections: Array<[FrameNumber, vtkActor]>;
  };
}

export interface Feature {
  x: number;
  y: number;
  z: number;
  frameNumber: number;
}

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
