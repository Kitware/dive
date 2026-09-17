import fs from 'fs-extra';
import os from 'os';
import npath from 'path';

import { resolveStereoConfig, resolveStereoConfigWithFallback } from './stereoConfig';

describe('resolveStereoConfig', () => {
  let viamePath: string;
  const pipelines = () => npath.join(viamePath, 'configs', 'pipelines');
  const touch = (rel: string) => fs.outputFileSync(npath.join(pipelines(), rel), '');

  beforeEach(() => {
    viamePath = fs.mkdtempSync(npath.join(os.tmpdir(), 'viame-stereo-'));
    touch('interactive_stereo_template.conf');
  });
  afterEach(() => fs.removeSync(viamePath));

  it('always resolves template matching', () => {
    expect(resolveStereoConfig(viamePath, 'ncc'))
      .toEqual({ config: npath.join(pipelines(), 'interactive_stereo_template.conf') });
  });

  it('errors when the Fast Foundation Stereo add-on is absent', () => {
    const r = resolveStereoConfig(viamePath, 'foundation');
    expect(r.config).toBeUndefined();
    expect(r.error).toContain('Fast Foundation Stereo');
    expect(r.error).toContain('interactive_stereo_fast_fdn_stereo.conf');
    expect(r.error).toContain('models/fast_foundation_stereo_l.onnx');
  });

  it('errors when the DINO add-on shipped its config but not its weights', () => {
    touch('interactive_stereo_ncc_dino.conf');
    const r = resolveStereoConfig(viamePath, 'dino');
    expect(r.error).toContain('DINO');
    expect(r.error).toContain('models/dinov2_vitb14.pth');
    expect(r.error).not.toContain('interactive_stereo_ncc_dino.conf');
  });

  it('resolves an installed add-on', () => {
    touch('interactive_stereo_fast_fdn_stereo.conf');
    touch('models/fast_foundation_stereo_l.onnx');
    expect(resolveStereoConfig(viamePath, 'foundation'))
      .toEqual({ config: npath.join(pipelines(), 'interactive_stereo_fast_fdn_stereo.conf') });
  });
});

describe('resolveStereoConfigWithFallback', () => {
  let viamePath: string;
  const pipelines = () => npath.join(viamePath, 'configs', 'pipelines');
  const touch = (rel: string) => fs.outputFileSync(npath.join(pipelines(), rel), '');

  beforeEach(() => {
    viamePath = fs.mkdtempSync(npath.join(os.tmpdir(), 'viame-stereo-'));
    touch('interactive_stereo_template.conf');
  });
  afterEach(() => fs.removeSync(viamePath));

  it('keeps the preferred method when its add-on is installed', () => {
    touch('interactive_stereo_fast_fdn_stereo.conf');
    touch('models/fast_foundation_stereo_l.onnx');
    expect(resolveStereoConfigWithFallback(viamePath, 'foundation')).toEqual({
      config: npath.join(pipelines(), 'interactive_stereo_fast_fdn_stereo.conf'),
      method: 'foundation',
      fellBack: false,
    });
  });

  it('falls back to ncc when Higher Quality is the default but unavailable', () => {
    expect(resolveStereoConfigWithFallback(viamePath, 'foundation')).toEqual({
      config: npath.join(pipelines(), 'interactive_stereo_template.conf'),
      method: 'ncc',
      fellBack: true,
    });
  });

  it('prefers dino over ncc when falling back from foundation', () => {
    touch('interactive_stereo_ncc_dino.conf');
    touch('models/dinov2_vitb14.pth');
    expect(resolveStereoConfigWithFallback(viamePath, 'foundation')).toEqual({
      config: npath.join(pipelines(), 'interactive_stereo_ncc_dino.conf'),
      method: 'dino',
      fellBack: true,
    });
  });

  it('returns the preferred method error when nothing is available', () => {
    fs.removeSync(npath.join(pipelines(), 'interactive_stereo_template.conf'));
    const r = resolveStereoConfigWithFallback(viamePath, 'foundation');
    expect('error' in r && r.error).toContain('Fast Foundation Stereo');
  });
});
