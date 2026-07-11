import { findRegistrationFilesInFileList } from './registrationParentFolder';

function mk(relativePath: string, content: string): File {
  const name = relativePath.split('/').pop() || relativePath;
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

const commonPathPrefix = () => 'collect';

const untypedRegistration = JSON.stringify({ version: 1, pairs: [] });
const typedRegistration = JSON.stringify({
  type: 'dive-camera-registration', version: 1, pairs: [],
});

describe('findRegistrationFilesInFileList', () => {
  it('accepts a root-level *_registration.json with pairs but no type', async () => {
    const found = await findRegistrationFilesInFileList([
      mk('collect/uv_to_eo_registration.json', untypedRegistration),
      mk('collect/eo/frame0.png', ''),
    ], 'collect', commonPathPrefix);
    expect(found.map((f) => f.path)).toStrictEqual(['uv_to_eo_registration.json']);
  });

  it('requires the type marker for other file names', async () => {
    const found = await findRegistrationFilesInFileList([
      mk('collect/transforms.json', typedRegistration),
      mk('collect/untyped-other.json', untypedRegistration),
      mk('collect/rig-calibration.json', JSON.stringify({ calibrations: {} })),
      mk('collect/broken.json', '{not json'),
    ], 'collect', commonPathPrefix);
    expect(found.map((f) => f.path)).toStrictEqual(['transforms.json']);
  });

  it('rejects a registration-named file without a pairs list', async () => {
    const found = await findRegistrationFilesInFileList([
      mk('collect/no_pairs_registration.json', JSON.stringify({ version: 1 })),
    ], 'collect', commonPathPrefix);
    expect(found).toStrictEqual([]);
  });

  it('ignores files below the root level', async () => {
    const found = await findRegistrationFilesInFileList([
      mk('collect/uv/uv_to_eo_registration.json', untypedRegistration),
    ], 'collect', commonPathPrefix);
    expect(found).toStrictEqual([]);
  });

  it('orders per-camera named files before other candidates, alphabetically', async () => {
    const found = await findRegistrationFilesInFileList([
      mk('collect/z-transforms.json', typedRegistration),
      mk('collect/uv_to_eo_registration.json', typedRegistration),
      mk('collect/ir_to_eo_registration.json', typedRegistration),
    ], 'collect', commonPathPrefix);
    expect(found.map((f) => f.path)).toStrictEqual([
      'ir_to_eo_registration.json',
      'uv_to_eo_registration.json',
      'z-transforms.json',
    ]);
  });
});
