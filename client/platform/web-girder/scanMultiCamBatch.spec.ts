import { scanMultiCamBatchFromFiles } from './scanMultiCamBatch';

function makeFile(relativePath: string): File {
  const name = relativePath.split('/').pop() ?? relativePath;
  const file = new File([''], name, { type: 'image/png' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

function frames(collect: string, camera: string, count: number, root = 'survey'): File[] {
  return Array.from({ length: count }, (_, index) => makeFile(
    `${root}/${collect}/${camera}/frame_${String(index).padStart(4, '0')}.png`,
  ));
}

describe('scanMultiCamBatchFromFiles', () => {
  it('produces import args for every valid collect', () => {
    const files = [
      ...frames('fl01', 'EO', 3),
      ...frames('fl01', 'IR', 3),
      ...frames('fl01', 'UV', 3),
      ...frames('fl02', 'EO', 2),
      ...frames('fl02', 'IR', 2),
      ...frames('fl02', 'UV', 2),
    ];
    const result = scanMultiCamBatchFromFiles('survey', files);
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['EO', 'IR', 'UV']);
    expect(result.collects.map((collect) => collect.name)).toEqual(['fl01', 'fl02']);
    result.collects.forEach((collect) => {
      expect(collect.importArgs).not.toBeNull();
      expect(collect.importArgs?.sourceList.EO.sourcePath).toBe(`survey/${collect.name}/EO`);
    });
  });

  it('flags a collect missing a camera folder without blocking others', () => {
    const files = [
      ...frames('fl01', 'EO', 3),
      ...frames('fl01', 'IR', 3),
      ...frames('fl02', 'EO', 3),
    ];
    const result = scanMultiCamBatchFromFiles('survey', files);
    expect(result.problems).toEqual([]);
    expect(result.collects[0].importArgs).not.toBeNull();
    expect(result.collects[1].problems).toEqual(['Missing camera folder "IR"']);
  });
});
