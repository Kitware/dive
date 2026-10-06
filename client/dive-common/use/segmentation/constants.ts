/**
 * Interactive segmentation polygon limits shared by web mask geometry and desktop
 * VIAME `service:*` settings (see `service:max_polygon_points` in
 * `interactive_segmenter_sam2.conf` / `interactive_segmenter_sam3.conf`).
 */

/** Default `service:max_polygon_points` when the config omits it. */
export const SegmentationMaxPolygonPoints = 25;

/** Maximum vertices when web point-click masks grow the budget for area error. */
export const SegmentationMaxPolygonPointsLimit = 100;

/** Relative ring area error (5%) that triggers doubling the vertex budget. */
export const SegmentationMaxPolygonAreaError = 0.05;
