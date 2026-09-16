import fs from 'fs-extra';
import os from 'os';
import npath from 'path';

import { resolveStereoConfig } from './stereoConfig';

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
