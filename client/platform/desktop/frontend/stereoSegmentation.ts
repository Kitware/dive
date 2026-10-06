/** Only refresh a counterpart created by this interactive segmentation session. */
export default function shouldTransferStereoSegmentation(options: {
  autoCompute: boolean;
  otherHasFeature: boolean;
  otherHadFeatureBeforeSegmentation?: boolean;
  otherHasUserLine: boolean;
}): boolean {
  return options.autoCompute && (!options.otherHasFeature
    || (options.otherHadFeatureBeforeSegmentation === false && !options.otherHasUserLine));
}
