import Track, { Feature, ConfidencePair, TrackId } from '@/lib/track';

interface CoordinateList{
    x: number;
    y: number;
}

interface FrameDataTrack {
  selected: boolean;
  editing: boolean;
  trackId: number;
  features: Feature;
  confidencePairs?: ConfidencePair[];
}

export {
  CoordinateList,
  FrameDataTrack,
};
