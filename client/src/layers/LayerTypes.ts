import { Feature } from '../track';

export interface FrameDataTrack {
  selected: boolean;
  editing: boolean | string;
  trackId: number;
  features: Feature | null;
  trackType: [string, number];
  confidencePairs: [string, number][] | null;
}
