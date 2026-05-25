import { pipelineTypeDisplay } from './pipelineTypeDisplay';

describe('pipelineTypeDisplay', () => {
  it('labels stereoscopic and measurement categories', () => {
    expect(pipelineTypeDisplay('stereo')).toBe('Stereoscopic');
    expect(pipelineTypeDisplay('measurement')).toBe('Measurement');
  });

  it('pluralizes other category keys', () => {
    expect(pipelineTypeDisplay('detector')).toBe('detectors');
  });
});
