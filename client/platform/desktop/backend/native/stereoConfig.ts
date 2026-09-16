/**
 * Maps the "Stereo point matching" setting onto the VIAME interactive stereo
 * config that implements it, checking that the add-on it needs is installed.
 */

import fs from 'fs-extra';
import npath from 'path';
import type { StereoMatchMethod } from 'dive-common/use/stereo/stereoMatcher';

interface StereoMethodFiles {
  config: string;
  /** Files (relative to configs/pipelines) the config cannot run without. */
  requires: string[];
  addon?: string;
}

export const STEREO_METHOD_FILES: Record<StereoMatchMethod, StereoMethodFiles> = {
  foundation: {
    config: 'interactive_stereo_fast_fdn_stereo.conf',
    requires: ['models/fast_foundation_stereo_l.onnx'],
    addon: 'Fast Foundation Stereo (FAST-FDN-STEREO)',
  },
  dino: {
    config: 'interactive_stereo_ncc_dino.conf',
    requires: ['models/dinov2_vitb14.pth'],
    addon: 'DINO',
  },
  ncc: {
    config: 'interactive_stereo_template.conf',
    requires: [],
  },
};

export function stereoMethodLabel(method: StereoMatchMethod): string {
  return {
    foundation: 'Higher Quality, Slower',
    dino: 'Medium Quality, Medium Speed',
    ncc: 'Lower Quality, Faster',
  }[method];
}

/**
 * The absolute config path for `method`, or an error naming the missing
 * add-on files so the user knows what to install.
 */
export function resolveStereoConfig(
  viamePath: string,
  method: StereoMatchMethod,
): { config: string; error?: undefined } | { config?: undefined; error: string } {
  const files = STEREO_METHOD_FILES[method];
  if (!files) {
    return { error: `Unknown stereo point matching method: ${method}` };
  }
  const pipelines = npath.join(viamePath, 'configs', 'pipelines');
  const missing = [files.config, ...files.requires]
    .filter((rel) => !fs.existsSync(npath.join(pipelines, rel)));
  if (missing.length === 0) {
    return { config: npath.join(pipelines, files.config) };
  }
  const label = stereoMethodLabel(method);
  const what = files.addon
    ? `The ${files.addon} add-on needed for "${label}" stereo point matching is not installed`
    : `The files needed for "${label}" stereo point matching are missing`;
  return {
    error: `${what} (missing ${missing.map((m) => npath.join('configs', 'pipelines', m)).join(', ')}). `
      + 'Install the add-on, or choose a different "Stereo point matching" setting.',
  };
}
