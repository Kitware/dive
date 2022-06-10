import Track from './track';
import BaseAnnotationStore from './BaseAnnotationStore';
import { AnnotationId } from './BaseAnnotation';

export default class TrackStore extends BaseAnnotationStore<Track> {
  add(frame: number, defaultType: string,
    afterId: AnnotationId | undefined, overrideTrackId: number) {
    const track = new Track(overrideTrackId, {
      begin: frame,
      end: frame,
      confidencePairs: [[defaultType, 1]],
    });
    this.insert(track, { afterId });
    this.markChangesPending({ action: 'upsert', track, cameraName: this.cameraName });
    return track;
  }
}
