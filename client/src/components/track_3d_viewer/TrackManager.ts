import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';

export type FrameNumber = number;

export type TrackTracker = {
  trackActor: vtkActor;
  hidden: boolean; // true if the track should remain hidden whatever happens
  detectionsMap: Map<FrameNumber, vtkActor>;
};

export type TracksMap = Map<AnnotationId, TrackTracker>;

export default class TrackManager {
  tracksMap: TracksMap;

  framesMap: Map<FrameNumber, vtkActor[]>;

  constructor() {
    this.tracksMap = new Map();
    this.framesMap = new Map();
  }

  registerTrack(
    trackId: AnnotationId,
    trackActor: vtkActor,
    frameDetections: Array<[FrameNumber, vtkActor]>,
  ) {
    const detectionsMap = new Map<FrameNumber, vtkActor>();

    frameDetections.forEach(([frameNumber, actor]) => {
      detectionsMap.set(frameNumber, actor);

      const actorList = this.framesMap.get(frameNumber);

      if (actorList) {
        actorList.push(actor);
      } else {
        this.framesMap.set(frameNumber, [actor]);
      }
    });

    this.tracksMap.set(trackId, {
      trackActor,
      detectionsMap,
      hidden: false, // track should not be hidden by default
    });
  }

  getFrameActors(frameNumber: FrameNumber) {
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
}
