import { Feature } from '@/lib/track';

interface FrameDataTrack {
  selected: boolean;
  editing: boolean;
  trackId: number;
  features: Feature | null;
  confidencePairs: [string, number] | null;
}

export {
  FrameDataTrack,
};
