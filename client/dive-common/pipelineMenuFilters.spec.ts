import {
  excludePipelinesMatchingTerms,
  filterPipelinesForDatasets,
  getMultiCamCameraCount,
} from './pipelineMenuFilters';
import type { Pipelines } from './apispec';

const samplePipelines: Pipelines = {
  measurement: { description: '', pipes: [{ name: 'gmm', type: 'measurement', pipe: 'measurement_gmm.pipe' }] },
  '2-cam': { description: '', pipes: [{ name: 'detector', type: '2-cam', pipe: 'detector_2-cam.pipe' }] },
  '3-cam': { description: '', pipes: [{ name: 'detector', type: '3-cam', pipe: 'detector_3-cam.pipe' }] },
  detector: { description: '', pipes: [{ name: 'default', type: 'detector', pipe: 'detector_default.pipe' }] },
  stereo: { description: '', pipes: [{ name: 'fish tracker', type: 'stereo', pipe: 'common_stereo_fish_tracker.pipe' }] },
};

describe('pipelineMenuFilters', () => {
  it('counts cameras from multiCam or multiCamMedia', () => {
    expect(getMultiCamCameraCount({ type: 'video' })).toBe(1);
    expect(getMultiCamCameraCount({
      type: 'multi',
      multiCam: { cameras: { left: {}, right: {} } },
    })).toBe(2);
    expect(getMultiCamCameraCount({
      type: 'multi',
      multiCamMedia: { cameras: { a: {}, b: {}, c: {} } },
    })).toBe(3);
  });

  it('hides measurement and multicam categories when subTypeList is empty', () => {
    const filtered = filterPipelinesForDatasets(samplePipelines, [], [1]);
    expect(filtered.measurement).toBeUndefined();
    expect(filtered.stereo).toBeUndefined();
    expect(filtered['2-cam']).toBeUndefined();
    expect(filtered['3-cam']).toBeUndefined();
    expect(filtered.detector).toBeDefined();
  });

  it('never shows legacy common_stereo category', () => {
    const filtered = filterPipelinesForDatasets(samplePipelines, ['stereo'], [2]);
    expect(filtered.stereo).toBeUndefined();
    expect(filtered.measurement).toBeDefined();
  });

  it('shows measurement only for all-stereo selection', () => {
    const filtered = filterPipelinesForDatasets(samplePipelines, ['stereo'], [2]);
    expect(filtered.measurement).toBeDefined();
    expect(filtered['2-cam']).toBeUndefined();
    expect(filtered.detector).toBeDefined();
  });

  it('shows matching multicam category only when all datasets share camera count', () => {
    const twoCam = filterPipelinesForDatasets(samplePipelines, ['multicam'], [2], ['multi']);
    expect(twoCam['2-cam']).toBeDefined();
    expect(twoCam['3-cam']).toBeUndefined();

    const mixed = filterPipelinesForDatasets(samplePipelines, ['multicam'], [2, 3], ['multi', 'multi']);
    expect(mixed['2-cam']).toBeUndefined();
    expect(mixed['3-cam']).toBeUndefined();
  });

  it('shows 3-cam for three-camera multi datasets without subType (legacy meta)', () => {
    const filtered = filterPipelinesForDatasets(
      samplePipelines,
      [null],
      [3],
      ['multi'],
    );
    expect(filtered['3-cam']).toBeDefined();
    expect(filtered['2-cam']).toBeUndefined();
  });

  it('counts cameras from multiCam.cameraOrder when present', () => {
    expect(getMultiCamCameraCount({
      type: 'multi',
      multiCam: {
        cameraOrder: ['a', 'b', 'c'],
        cameras: { a: {}, b: {}, c: {} },
      },
    })).toBe(3);
  });

  it('hides special categories for non-multicam subtypes', () => {
    const filtered = filterPipelinesForDatasets(samplePipelines, [null], [1]);
    expect(filtered.measurement).toBeUndefined();
    expect(filtered['2-cam']).toBeUndefined();
    expect(filtered.detector).toBeDefined();
  });

  it('removes pipelines whose names contain excluded terms', () => {
    const withSeagis: typeof samplePipelines = {
      ...samplePipelines,
      detector: {
        description: '',
        pipes: [
          ...samplePipelines.detector.pipes,
          { name: 'seagis tracker', type: 'detector', pipe: 'detector_seagis_motion.pipe' },
        ],
      },
    };
    const filtered = excludePipelinesMatchingTerms(withSeagis, ['seagis']);
    expect(filtered.detector.pipes).toHaveLength(1);
    expect(filtered.detector.pipes[0].name).toBe('default');
  });

  it('applies excludePipelineTerms in filterPipelinesForDatasets', () => {
    const withSeagis: typeof samplePipelines = {
      ...samplePipelines,
      utility: {
        description: '',
        pipes: [{ name: 'seagis utility', type: 'utility', pipe: 'utility_seagis_tool.pipe' }],
      },
    };
    const filtered = filterPipelinesForDatasets(withSeagis, [null], [1], undefined, ['seagis']);
    expect(filtered.utility).toBeUndefined();
    expect(filtered.detector).toBeDefined();
  });
});
