import pipelineTypeDisplay from './pipelineTypeDisplay';

describe('pipelineTypeDisplay', () => {
  it('labels measurement category', () => {
    expect(pipelineTypeDisplay('measurement')).toBe('Measurement');
  });

  it('pluralizes other category keys', () => {
    expect(pipelineTypeDisplay('detector')).toBe('detectors');
  });
});
