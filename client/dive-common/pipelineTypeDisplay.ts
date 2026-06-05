/** User-facing label for a pipeline category key from getPipelineList(). */
export default function pipelineTypeDisplay(pipeType: string): string {
  switch (pipeType) {
    case 'trained':
      return 'trained';
    case 'utility':
    case 'generate':
      return 'utilities';
    case 'transcode':
      return 'transcoders';
    case 'measurement':
      return 'Measurement';
    default:
      return `${pipeType}s`;
  }
}
