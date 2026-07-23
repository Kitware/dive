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

  /* Suppression type name when the detection is attribute-flagged as
   * suppressed: layers may draw a dashed/custom fill outline and show an
   * eye-off tag on the canvas label and hover tooltip. Real type is unchanged. */
  suppressed?: string;

  /* The Set if it exists for the Track */
  set?: string;

  /* All types related to the current annotation */
  // confidencePairs: [string, number][] | null;
}
