import {
  calibrationRequiredPipelineMessage,
  pipelineDisabledForMissingCalibration,
  pipelineRequiresCalibration,
} from './pipelineCalibration';
import type { Pipe } from './apispec';

describe('pipelineCalibration', () => {
  const measurementPipe: Pipe = {
    name: 'gmm',
    type: 'measurement',
    pipe: 'measurement_gmm.pipe',
  };

  it('requires calibration when metadata flag is true', () => {
    const pipe: Pipe = {
      ...measurementPipe,
      metadata: { requiresCalibration: true },
    };
    expect(pipelineRequiresCalibration(pipe)).toBe(true);
  });

  it('does not require calibration when metadata flag is false', () => {
    const pipe: Pipe = {
      name: 'detector',
      type: 'detector',
      pipe: 'detector_default.pipe',
      metadata: { requiresCalibration: false },
    };
    expect(pipelineRequiresCalibration(pipe)).toBe(false);
  });

  it('does not require calibration when metadata flag is absent', () => {
    expect(pipelineRequiresCalibration(measurementPipe)).toBe(false);
  });

  it('disables calibration pipelines when any selected dataset lacks calibration', () => {
    const pipe: Pipe = {
      ...measurementPipe,
      metadata: { requiresCalibration: true },
    };
    expect(pipelineDisabledForMissingCalibration(
      pipe,
      { ds1: true, ds2: false },
      ['ds1', 'ds2'],
    )).toBe(true);
    expect(pipelineDisabledForMissingCalibration(
      pipe,
      { ds1: true, ds2: true },
      ['ds1', 'ds2'],
    )).toBe(false);
  });

  it('exports a user-facing calibration message', () => {
    expect(calibrationRequiredPipelineMessage).toMatch(/requires a calibration file/i);
  });
});
