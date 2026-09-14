import type { Pipe } from 'dive-common/apispec';
import { pipelineHasParams, pipelineRequiresParams } from './pipelineParams';

/** Build a Pipe; omitting diveParams yields a pipeline with no metadata. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pipe(diveParams?: any[]): Pipe {
  return {
    name: 'Test Pipeline',
    pipe: 'test.pipe',
    type: 'detector',
    ...(diveParams === undefined ? {} : { metadata: { diveParams } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const optionalParam = {
  label: 'Threshold', type: 'float', key: 'detector:thresh', default: '0.5',
};
const requiredParam = {
  label: 'Model', type: 'string', key: 'detector:model', default: '', required: true,
};

describe('pipelineHasParams', () => {
  it('is false when the pipeline has no metadata at all', () => {
    expect(pipelineHasParams(pipe())).toBe(false);
  });

  it('is false for an empty param list', () => {
    expect(pipelineHasParams(pipe([]))).toBe(false);
  });

  it('is true when the pipeline exposes params', () => {
    expect(pipelineHasParams(pipe([optionalParam]))).toBe(true);
  });
});

describe('pipelineRequiresParams', () => {
  it('is false when the pipeline has no metadata at all', () => {
    expect(pipelineRequiresParams(pipe())).toBe(false);
  });

  it('is false for an empty param list', () => {
    expect(pipelineRequiresParams(pipe([]))).toBe(false);
  });

  // The point of the change: optional params must not force the dialog, so a
  // plain click runs the pipeline with the .pipe file's own values.
  it('is false when every param is optional', () => {
    expect(pipelineRequiresParams(pipe([optionalParam, { ...optionalParam, key: 'b' }]))).toBe(false);
  });

  it('is false when required is explicitly false', () => {
    expect(pipelineRequiresParams(pipe([{ ...optionalParam, required: false }]))).toBe(false);
  });

  it('is true when any single param is required', () => {
    expect(pipelineRequiresParams(pipe([optionalParam, requiredParam]))).toBe(true);
  });

  it('is true when the only param is required', () => {
    expect(pipelineRequiresParams(pipe([requiredParam]))).toBe(true);
  });
});
