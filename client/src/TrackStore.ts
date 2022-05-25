import Track from './track';
import BaseAnnotationStore from './BaseAnnotationStore';
import { AnnotationId } from './BaseAnnotation';

export default class TrackStore extends BaseAnnotationStore<Track> {
  add(frame: number, defaultType: string, afterId?: AnnotationId) {
    const track = new Track(this.getNewId(), {
      begin: frame,
      end: frame,
      confidencePairs: [[defaultType, 1]],
    });
    this.insert(track, { afterId });
    this.markChangesPending({ action: 'upsert', track });
    return track;
  }
}
