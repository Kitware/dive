import Group from '../Group';
import Track, { Feature } from '../track';

export interface FrameDataTrack {
  /* Current annotation selection state */
  selected: boolean;

  /* Current annotation editing state */
  editing: boolean | string;

  /* A reference to the track */
  track: Track;

  /* Any groups that this annotation is a member of */
  groups: Group[];

  /* The feature for the current frame */
  features: Feature | null;

  /* The exact pair to base the style on  */
  styleType: [string, number];

  /* All types related to the current annotation */
  // confidencePairs: [string, number][] | null;
}
