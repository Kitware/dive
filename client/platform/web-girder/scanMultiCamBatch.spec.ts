import { scanMultiCamBatchFromFiles } from './scanMultiCamBatch';

function makeFile(relativePath: string, content = ''): File {
  const name = relativePath.split('/').pop() ?? relativePath;
  const file = new File([content], name, { type: 'image/png' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

function frames(collect: string, camera: string, count: number, root = 'survey'): File[] {
  return Array.from({ length: count }, (_, index) => makeFile(
    `${root}/${collect}/${camera}/frame_${String(index).padStart(4, '0')}.png`,
  ));
}

describe('scanMultiCamBatchFromFiles', () => {
  it('produces import args for every valid collect', async () => {
    const files = [
      ...frames('fl01', 'EO', 3),
      ...frames('fl01', 'IR', 3),
      ...frames('fl01', 'UV', 3),
      ...frames('fl02', 'EO', 2),
      ...frames('fl02', 'IR', 2),
      ...frames('fl02', 'UV', 2),
    ];
    const result = await scanMultiCamBatchFromFiles('survey', files);
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['EO', 'UV', 'IR']);
    expect(result.collects.map((collect) => collect.name)).toEqual(['fl01', 'fl02']);
    result.collects.forEach((collect) => {
      expect(collect.importArgs).not.toBeNull();
      expect(collect.importArgs?.sourceList.EO.sourcePath).toBe(`survey/${collect.name}/EO`);
    });
  });

  it('flags a collect missing a camera folder without blocking others', async () => {
    const files = [
      ...frames('fl01', 'EO', 3),
      ...frames('fl01', 'IR', 3),
      ...frames('fl02', 'EO', 3),
    ];
    const result = await scanMultiCamBatchFromFiles('survey', files);
    expect(result.problems).toEqual([]);
    expect(result.collects[0].importArgs).not.toBeNull();
    expect(result.collects[1].problems).toEqual(['Missing camera folder "IR"']);
  });

  it('attaches per-collect registration files to import args', async () => {
    const registration = JSON.stringify({ version: 1, pairs: [] });
    const files = [
      ...frames('fl01', 'EO', 3),
      ...frames('fl01', 'IR', 3),
      ...frames('fl02', 'EO', 3),
      ...frames('fl02', 'IR', 3),
      makeFile('survey/fl01/ir_to_eo_registration.json', registration),
    ];
    const result = await scanMultiCamBatchFromFiles('survey', files);
    expect(result.problems).toEqual([]);
    expect(result.collects[0].transformFiles).toEqual(['ir_to_eo_registration.json']);
    expect(result.collects[0].importArgs?.sourceList.IR.transformFile)
      .toBe('survey/fl01/ir_to_eo_registration.json');
    expect(result.collects[1].transformFiles).toEqual([]);
    expect(result.collects[1].importArgs?.sourceList.IR.transformFile).toBeUndefined();
  });

  it('infers modality cameras for flat view-folder collects', async () => {
    const viewFile = (view: string, second: string, modality: string, ext = 'jpg') => makeFile(
      `fl09/${view}/fl09_20240612_2041${second}.625730_${modality}.${ext}`,
    );
    const files = [
      viewFile('center_view', '07', 'rgb'),
      viewFile('center_view', '08', 'rgb'),
      viewFile('center_view', '07', 'ir', 'tif'),
      viewFile('left_view', '07', 'rgb'),
      viewFile('left_view', '07', 'ir', 'tif'),
      makeFile('fl09/center_view/metadata.json'),
    ];
    const result = await scanMultiCamBatchFromFiles('fl09', files);
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['rgb', 'ir']);
    const [center, left] = result.collects;
    expect(center.name).toBe('center_view');
    expect(center.importArgs?.datasetName).toBe('fl09_center_view');
    expect(center.importArgs?.defaultDisplay).toBe('rgb');
    expect(center.importArgs?.sourceList.rgb).toEqual({
      sourcePath: 'fl09/center_view',
      trackFile: '',
      glob: '*_rgb.*',
    });
    expect(center.cameras.map((c) => [c.name, c.imageCount])).toEqual([['rgb', 2], ['ir', 1]]);
    expect(left.importArgs?.datasetName).toBe('fl09_left_view');
  });
});
