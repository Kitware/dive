import shouldTransferStereoSegmentation from './stereoSegmentation';

describe('interactive stereo segmentation updates', () => {
  it('transfers the first mask and refreshes its counterpart on subsequent clicks', () => {
    const options = { autoCompute: true, otherHasFeature: false, otherHasUserLine: false };
    expect(shouldTransferStereoSegmentation(options)).toBe(true);
    // The first transfer snapshots an empty counterpart, then creates it.
    // Adding a second polygon must still transfer the updated mask and length.
    expect(shouldTransferStereoSegmentation({
      ...options, otherHasFeature: true, otherHadFeatureBeforeSegmentation: false,
    })).toBe(true);
  });

  it.each([true, undefined])('preserves a counterpart from before the session (%s)', (hadFeature) => {
    expect(shouldTransferStereoSegmentation({
      autoCompute: true,
      otherHasFeature: true,
      otherHadFeatureBeforeSegmentation: hadFeature,
      otherHasUserLine: false,
    })).toBe(false);
  });

  it('preserves a counterpart whose line the user edited during the session', () => {
    expect(shouldTransferStereoSegmentation({
      autoCompute: true,
      otherHasFeature: true,
      otherHadFeatureBeforeSegmentation: false,
      otherHasUserLine: true,
    })).toBe(false);
  });

  it.each([false, true])('honors disabled matching with an existing counterpart: %s', (otherHasFeature) => {
    expect(shouldTransferStereoSegmentation({
      autoCompute: false,
      otherHasFeature,
      otherHadFeatureBeforeSegmentation: false,
      otherHasUserLine: false,
    })).toBe(false);
  });
});
