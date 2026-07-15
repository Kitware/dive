import {
  assignRegistrationFilesToCameras,
  findRegistrationFilesInFileList,
} from './registrationParentFolder';

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

describe('assignRegistrationFilesToCameras', () => {
  it('matches files to their named camera slot, case-insensitively', () => {
    const { assignments, unassigned } = assignRegistrationFilesToCameras(
      ['/root/ir_to_eo_registration.json', '/root/uv_registration.json'],
      ['EO', 'UV', 'IR'],
    );
    expect(assignments).toStrictEqual([
      { camera: 'IR', filePath: '/root/ir_to_eo_registration.json' },
      { camera: 'UV', filePath: '/root/uv_registration.json' },
    ]);
    expect(unassigned).toStrictEqual([]);
  });

  it('sends an unmatched file to the first free non-reference slot', () => {
    const { assignments } = assignRegistrationFilesToCameras(
      ['/root/transforms.json'],
      ['EO', 'UV', 'IR'],
    );
    expect(assignments).toStrictEqual([
      { camera: 'UV', filePath: '/root/transforms.json' },
    ]);
  });

  it('never assigns to the reference camera and reports leftovers', () => {
    const { assignments, unassigned } = assignRegistrationFilesToCameras(
      [
        '/root/eo_registration.json',
        '/root/ir_registration.json',
        '/root/extra.json',
        '/root/more.json',
      ],
      ['EO', 'IR'],
    );
    expect(assignments).toStrictEqual([
      { camera: 'IR', filePath: '/root/ir_registration.json' },
    ]);
    expect(unassigned).toStrictEqual([
      '/root/eo_registration.json',
      '/root/extra.json',
      '/root/more.json',
    ]);
  });
});
