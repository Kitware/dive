import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import { RGBColor } from './lookupTable';

export type FrameNumber = number;

export type TrackTracker = {
  trackActor: vtkActor;
  hidden: boolean; // true if the track should remain hidden whatever happens
  detectionsMap: Map<FrameNumber, vtkActor>;
  trackColor: RGBColor;
  trackType: string;
};

export type TracksMap = Map<AnnotationId, TrackTracker>;

export type FramesMap = Map<FrameNumber, {
  trackIds: AnnotationId[];
  detectionActors: vtkActor[];
}>;

export default class TrackManager {
  tracksMap: TracksMap;

  framesMap: FramesMap;

  constructor() {
    this.tracksMap = new Map();
    this.framesMap = new Map();
  }

  registerTrack(
    trackId: AnnotationId,
    trackActor: vtkActor,
    frameDetections: Array<[FrameNumber, vtkActor]>,
    trackColor: RGBColor,
    trackType: string,
  ) {
    const detectionsMap = new Map<FrameNumber, vtkActor>();

    frameDetections.forEach(([frameNumber, actor]) => {
      actor.getProperty().setDiffuse(0.6);
      actor.getProperty().setAmbient(0.6);
      detectionsMap.set(frameNumber, actor);

      const frameTracker = this.framesMap.get(frameNumber);

      if (frameTracker) {
        frameTracker.trackIds.push(trackId);
        frameTracker.detectionActors.push(actor);
      } else {
        this.framesMap.set(frameNumber, {
          trackIds: [trackId],
          detectionActors: [actor],
        });
      }
    });

    this.tracksMap.set(trackId, {
      trackActor,
      detectionsMap,
      hidden: false, // track should not be hidden by default
      trackColor,
      trackType,
    });
  }

  getFrameTracker(frameNumber: FrameNumber) {
    return this.framesMap.get(frameNumber);
  }

  getTrackFrameDetection(trackId: AnnotationId, frameNumber: FrameNumber) {
    return this.tracksMap.get(trackId)?.detectionsMap.get(frameNumber);
  }

  forEachTrack(cb: (track: TrackTracker, trackId: AnnotationId) => void) {
    this.tracksMap.forEach(cb);
  }

  getTrack(trackId: AnnotationId) {
    return this.tracksMap.get(trackId);
  }

  getAllTracks() {
    return this.tracksMap;
  }

  hasTrack(trackId: AnnotationId) {
    return this.tracksMap.has(trackId);
  }

  getTrackActorsInFrameRange(frameStart: number, frameCount: number) {
    const trackActors: Set<vtkActor> = new Set();

    // eslint-disable-next-line no-plusplus
    for (let frame = frameStart; frame < frameStart + frameCount; frame++) {
      const frameTracker = this.framesMap.get(frame);

      if (frameTracker && frameTracker.trackIds.length > 0) {
        frameTracker.trackIds.forEach((trackId) => {
          trackActors.add(
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.tracksMap.get(trackId)!.trackActor,
          );
        });
      }
    }

    return trackActors;
  }
}
