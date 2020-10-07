export interface Annotator extends Vue {
  frame: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geoViewer: any;
  playing: boolean;
  maxFrame: number;
  syncedFrame: number;
  filename: string;
}
