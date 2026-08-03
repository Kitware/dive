import mockfs from 'mock-fs';
import npath from 'path';
import fs from 'fs-extra';
import {
  it, expect, describe, afterAll, vi,
} from 'vitest';

import { Settings, JsonMeta } from 'platform/desktop/constants';
import { buildRegistrationPipelineArgs } from './cameraRegistration';

// mock-fs no longer intercepts fs-extra's exists checks on newer Node;
// route them through statSync like common.spec.ts does.
vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
  const fsNode = await import('node:fs');
  const existsByStat = (targetPath: fsNode.PathLike) => {
    try {
      fsNode.statSync(targetPath);
      return true;
    } catch {
      return false;
    }
  };

  const patchedDefault = {
    ...actual.default,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };

  return {
    ...actual,
    default: patchedDefault,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };
});

const settings: Settings = {
  version: 1,
  dataPath: '/home/user/viamedata',
  viamePath: '/opt/viame',
  readonlyMode: false,
  overrides: {},
};

const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const irToRgb = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];
const uvToRgb = [[1, 0, -8], [0, 1, 2], [0, 0, 1]];

function registrationFile(pairs: unknown[]) {
  return JSON.stringify({ type: 'dive-camera-registration', version: 1, pairs });
}

const projectFiles = { 'meta.json': '{}', 'result_1.json': '{}' };

mockfs({
  [npath.join(settings.dataPath, 'DIVE_Projects')]: {
    withreg: {
      ...projectFiles,
      'ir_to_rgb_registration.json': registrationFile([
        {
          left: 'ir', right: 'rgb', points: [], leftToRight: irToRgb, rightToLeft: identity,
        },
      ]),
      'uv_to_rgb_registration.json': registrationFile([
        {
          left: 'uv', right: 'rgb', points: [], leftToRight: uvToRgb, rightToLeft: identity,
        },
      ]),
    },
    partial: {
      ...projectFiles,
      'ir_to_rgb_registration.json': registrationFile([
        {
          left: 'ir', right: 'rgb', points: [], leftToRight: irToRgb, rightToLeft: identity,
        },
      ]),
      // Non-star pair (two non-reference cameras): explicitly unsupported
      // for pipelines even though fitted.
      'uv_to_ir_registration.json': registrationFile([
        {
          left: 'uv', right: 'ir', points: [], leftToRight: uvToRgb, rightToLeft: identity,
        },
      ]),
    },
    noreg: { ...projectFiles },
    seeded: { ...projectFiles },
  },
  '/home/user/job': {},
});

afterAll(() => mockfs.restore());

function multiCamMeta(id: string, cameras: string[], defaultDisplay: string): JsonMeta {
  return {
    version: 1,
    type: 'multi',
    id,
    fps: 1,
    originalBasePath: '/home/user/data',
    originalImageFiles: [],
    originalVideoFile: '',
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: id,
    createdAt: 'now',
    subType: 'multicam',
    multiCam: {
      cameras: Object.fromEntries(cameras.map((name) => [name, {
        type: 'image-sequence',
        originalBasePath: `/home/user/data/${name}`,
        originalImageFiles: [],
        originalVideoFile: '',
        transcodedVideoFile: '',
        transcodedImageFiles: [],
      }])),
      defaultDisplay,
    },
  } as unknown as JsonMeta;
}

describe('buildRegistrationPipelineArgs', () => {
  it('writes one file per camera pair and pins each warp pair/direction', async () => {
    // Display order intentionally scrambles the input: the pipeline order is
    // reference-first then display order (rgb, uv, ir -- IR displays last),
    // so uv lands on input2 / warp2 and ir on input3 / warp3.
    const meta = multiCamMeta('withreg', ['ir', 'rgb', 'uv'], 'rgb');
    const jobWorkDir = '/home/user/job/full';
    await fs.ensureDir(jobWorkDir);
    const args = await buildRegistrationPipelineArgs(settings, meta, jobWorkDir);

    const irPath = npath.join(jobWorkDir, 'ir_to_rgb_registration.json');
    const uvPath = npath.join(jobWorkDir, 'uv_to_rgb_registration.json');
    expect(args).toStrictEqual({
      'warp2:transformation_file': uvPath,
      'warp2:transform_reader:type': 'dive',
      'warp2:transform_reader:dive:from_camera': 'uv',
      'warp2:transform_reader:dive:to_camera': 'rgb',
      'warp3:transformation_file': irPath,
      'warp3:transform_reader:type': 'dive',
      'warp3:transform_reader:dive:from_camera': 'ir',
      'warp3:transform_reader:dive:to_camera': 'rgb',
    });
    const written = await fs.readJSON(irPath);
    expect(written.type).toBe('dive-camera-registration');
    expect(written.pairs).toHaveLength(1);
    expect(written.pairs[0].left).toBe('ir');
    expect(written.pairs[0].right).toBe('rgb');
    expect(written.pairs[0].leftToRight).toStrictEqual(irToRgb);
    expect((await fs.readJSON(uvPath)).pairs[0].left).toBe('uv');
  });

  it('skips cameras without a fitted reference pair; non-star pairs never reach the job', async () => {
    const meta = multiCamMeta('partial', ['rgb', 'ir', 'uv'], 'rgb');
    const jobWorkDir = '/home/user/job/partial';
    await fs.ensureDir(jobWorkDir);
    const args = await buildRegistrationPipelineArgs(settings, meta, jobWorkDir);
    // Pipeline order is rgb, uv, ir: uv (warp2) has only the unsupported
    // uv-to-ir pair, so it gets nothing; ir (warp3) has a reference pair.
    expect(Object.keys(args).some((key) => key.startsWith('warp2'))).toBe(false);
    expect(args['warp3:transform_reader:dive:from_camera']).toBe('ir');
    const irPath = npath.join(jobWorkDir, 'ir_to_rgb_registration.json');
    expect(args['warp3:transformation_file']).toBe(irPath);
    // The uv-to-ir pair is dropped from ir's job file too.
    const written = await fs.readJSON(irPath);
    expect(written.pairs).toHaveLength(1);
    expect(written.pairs[0].right).toBe('rgb');
    expect(await fs.readdir(jobWorkDir)).toStrictEqual(['ir_to_rgb_registration.json']);
  });

  it('returns no args when the dataset has no registration', async () => {
    const meta = multiCamMeta('noreg', ['rgb', 'ir'], 'rgb');
    const jobWorkDir = '/home/user/job/noreg';
    await fs.ensureDir(jobWorkDir);
    const args = await buildRegistrationPipelineArgs(settings, meta, jobWorkDir);
    expect(args).toStrictEqual({});
    expect(await fs.readdir(jobWorkDir)).toStrictEqual([]);
  });

  it('falls back to the import-time seed in dataset meta when no files exist', async () => {
    const meta = multiCamMeta('seeded', ['rgb', 'ir'], 'rgb');
    meta.cameraHomographies = {
      'ir::rgb': { AtoB: irToRgb, BtoA: identity },
    };
    const jobWorkDir = '/home/user/job/seeded';
    await fs.ensureDir(jobWorkDir);
    const args = await buildRegistrationPipelineArgs(settings, meta, jobWorkDir);
    expect(args['warp2:transform_reader:dive:from_camera']).toBe('ir');
    expect(args['warp2:transform_reader:dive:to_camera']).toBe('rgb');
  });
});
