import { parseRegistrationSeed } from './multicamRegistrationSeed';

const SHIFT = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];
const UNSHIFT = [[1, 0, -5], [0, 1, 3], [0, 0, 1]];

function registrationFile(
  name: string,
  pairs: unknown[],
  source?: Record<string, unknown>,
): File {
  return new File([JSON.stringify({
    type: 'dive-camera-registration',
    version: 1,
    ...(source ? { source } : {}),
    pairs,
  })], name, { type: 'application/json' });
}

const eoIrPair = {
  left: 'eo',
  right: 'ir',
  points: [[0, 0, 5, -3], [10, 0, 15, -3]],
  leftToRight: SHIFT,
  rightToLeft: UNSHIFT,
  transformType: 'translation',
};

describe('parseRegistrationSeed', () => {
  it('seeds pairs, points, transform types, and the producer stamp', async () => {
    const source = { model: 'colmap-2026-07-01', swathe: 'fl07_C' };
    const { values, warnings } = await parseRegistrationSeed([{
      cameraName: 'ir',
      fileName: 'ir_to_eo_registration.json',
      file: registrationFile('ir_to_eo_registration.json', [eoIrPair], source),
    }], ['eo', 'ir']);
    expect(warnings).toStrictEqual([]);
    expect(values?.homographies['eo::ir'].AtoB).toEqual(SHIFT);
    expect(values?.correspondences['eo::ir']).toHaveLength(2);
    expect(values?.transformTypes['eo::ir']).toBe('translation');
    expect(values?.source).toEqual(source);
  });

  it('warns (but seeds) when pairs name cameras the dataset does not have', async () => {
    const { values, warnings } = await parseRegistrationSeed([{
      cameraName: 'ir',
      fileName: 'uv_to_rgb_registration.json',
      file: registrationFile('uv_to_rgb_registration.json', [{
        left: 'uv', right: 'rgb', points: [], leftToRight: SHIFT, rightToLeft: UNSHIFT,
      }]),
    }], ['eo', 'ir']);
    expect(values?.homographies['uv::rgb']).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('uv_to_rgb_registration.json');
    expect(warnings[0]).toContain('rgb, uv');
  });

  it('records disagreeing producer stamps as a mixed composite', async () => {
    const { values } = await parseRegistrationSeed([
      {
        cameraName: 'ir',
        fileName: 'ir_to_eo_registration.json',
        file: registrationFile('ir_to_eo_registration.json', [eoIrPair], { model: 'a' }),
      },
      {
        cameraName: 'uv',
        fileName: 'uv_to_eo_registration.json',
        file: registrationFile('uv_to_eo_registration.json', [{
          left: 'eo', right: 'uv', points: [], leftToRight: SHIFT, rightToLeft: UNSHIFT,
        }], { model: 'b' }),
      },
    ], ['eo', 'ir', 'uv']);
    expect(values?.source).toEqual({
      mixed: true,
      files: {
        'ir_to_eo_registration.json': { model: 'a' },
        'uv_to_eo_registration.json': { model: 'b' },
      },
    });
  });

  it('returns null values when no file contributes any pairs', async () => {
    const { values, warnings } = await parseRegistrationSeed([{
      cameraName: 'ir',
      fileName: 'empty_registration.json',
      file: registrationFile('empty_registration.json', []),
    }], ['eo', 'ir']);
    expect(values).toBeNull();
    expect(warnings).toStrictEqual([]);
  });

  it('fails with camera context for an invalid file', async () => {
    await expect(parseRegistrationSeed([{
      cameraName: 'ir',
      fileName: 'bad.json',
      file: new File(['{ "some": "other json" }'], 'bad.json'),
    }], ['eo', 'ir'])).rejects.toThrow(
      /Camera "ir": invalid transform file: Not a DIVE camera registration file/,
    );
  });

  it('fails when the stashed File is gone', async () => {
    await expect(parseRegistrationSeed([{
      cameraName: 'ir',
      fileName: 'gone.json',
      file: undefined,
    }], ['eo', 'ir'])).rejects.toThrow(/no longer available; please re-select/);
  });
});
