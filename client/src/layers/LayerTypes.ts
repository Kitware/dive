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

  /* Suppression type name when the detection displays as suppressed
   * (flagged by the suppression attribute): layers label it
   * 'Type - SuppressionType' and draw a dashed outline. */
  suppressed?: string;

  /* The Set if it exists for the Track */
  set?: string;

  /* All types related to the current annotation */
  // confidencePairs: [string, number][] | null;
}
