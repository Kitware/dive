import { Feature } from '@/lib/track';

export interface FrameDataTrack {
  selected: boolean;
  editing: boolean;
  trackId: number;
  features: Feature | null;
  confidencePairs: [string, number] | null;
}
