export interface Annotator {
  frame: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geoViewer: any;
  playing: boolean;
  maxFrame: number;
  syncedFrame: number;
}