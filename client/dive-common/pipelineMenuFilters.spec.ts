import {
  filterPipelinesForDatasets,
  getMultiCamCameraCount,
  isStereoscopicSelection,
} from './pipelineMenuFilters';
import type { Pipelines } from './apispec';

const samplePipelines: Pipelines = {
  measurement: { description: '', pipes: [{ name: 'gmm', type: 'measurement', pipe: 'measurement_gmm.pipe' }] },
  stereo: { description: '', pipes: [{ name: 'fish tracker', type: 'stereo', pipe: 'common_stereo_fish_tracker.pipe' }] },
  '2-cam': { description: '', pipes: [{ name: 'detector', type: '2-cam', pipe: 'detector_2-cam.pipe' }] },
  '3-cam': { description: '', pipes: [{ name: 'detector', type: '3-cam', pipe: 'detector_3-cam.pipe' }] },
  detector: { description: '', pipes: [{ name: 'default', type: 'detector', pipe: 'detector_default.pipe' }] },
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

  it('hides measurement, stereo, and multicam categories when subTypeList is empty', () => {
    const filtered = filterPipelinesForDatasets(samplePipelines, [], [1]);
    expect(filtered.measurement).toBeUndefined();
    expect(filtered.stereo).toBeUndefined();
    expect(filtered['2-cam']).toBeUndefined();
    expect(filtered['3-cam']).toBeUndefined();
    expect(filtered.detector).toBeDefined();
  });

  it('shows measurement and stereo only for all-stereo selection', () => {
    const filtered = filterPipelinesForDatasets(samplePipelines, ['stereo'], [2]);
    expect(filtered.measurement).toBeDefined();
    expect(filtered.stereo).toBeDefined();
    expect(filtered['2-cam']).toBeUndefined();
    expect(filtered.detector).toBeDefined();
  });

  it('shows stereoscopic pipelines for legacy 2-camera multi without subType', () => {
    expect(isStereoscopicSelection([null], [2], ['multi'])).toBe(true);
    const filtered = filterPipelinesForDatasets(samplePipelines, [null], [2], ['multi']);
    expect(filtered.measurement).toBeDefined();
    expect(filtered.stereo).toBeDefined();
    expect(filtered['2-cam']).toBeUndefined();
  });

  it('hides stereo category when selection is not all-stereo', () => {
    const filtered = filterPipelinesForDatasets(samplePipelines, ['multicam'], [2], ['multi']);
    expect(filtered.stereo).toBeUndefined();
    expect(filtered.measurement).toBeUndefined();
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
    expect(filtered.stereo).toBeUndefined();
    expect(filtered['2-cam']).toBeUndefined();
    expect(filtered.detector).toBeDefined();
  });
});
