import { isFilterPipeline, pipelineCreatesNewDataset } from './pipelineCreatesDataset';

describe('pipelineCreatesNewDataset', () => {
  it('matches filter and transcode types', () => {
    expect(pipelineCreatesNewDataset({ type: 'filter', pipe: 'filter_enhance.pipe' })).toBe(true);
    expect(pipelineCreatesNewDataset({ type: 'transcode', pipe: 'transcode_default.pipe' })).toBe(true);
  });

  it('matches filter/transcode pipes categorized as N-cam', () => {
    expect(pipelineCreatesNewDataset({
      type: '2-cam',
      pipe: 'filter_register_frames_2-cam.pipe',
    })).toBe(true);
    expect(pipelineCreatesNewDataset({
      type: '3-cam',
      pipe: 'filter_compute_tile_mosaics_3-cam.pipe',
    })).toBe(true);
    expect(pipelineCreatesNewDataset({
      type: '2-cam',
      pipe: 'transcode_enhance_2-cam.pipe',
    })).toBe(true);
  });

  it('does not match ordinary detector/tracker multicam pipes', () => {
    expect(pipelineCreatesNewDataset({ type: '2-cam', pipe: 'detector_2-cam.pipe' })).toBe(false);
    expect(pipelineCreatesNewDataset({ type: 'detector', pipe: 'detector_default.pipe' })).toBe(false);
  });
});

describe('isFilterPipeline', () => {
  it('matches filter type and filter_ prefix', () => {
    expect(isFilterPipeline({ type: 'filter', pipe: 'filter_enhance.pipe' })).toBe(true);
    expect(isFilterPipeline({
      type: '2-cam',
      pipe: 'filter_register_frames_2-cam.pipe',
    })).toBe(true);
  });

  it('does not match non-filter pipes', () => {
    expect(isFilterPipeline({ type: 'transcode', pipe: 'transcode_default.pipe' })).toBe(false);
    expect(isFilterPipeline({ type: '2-cam', pipe: 'detector_2-cam.pipe' })).toBe(false);
  });
});
