import pipelineTypeDisplay from './pipelineTypeDisplay';

describe('pipelineTypeDisplay', () => {
  it('labels stereo category', () => {
    expect(pipelineTypeDisplay('stereo')).toBe('Stereo');
  });

  it('pluralizes other category keys', () => {
    expect(pipelineTypeDisplay('detector')).toBe('detectors');
  });
});
