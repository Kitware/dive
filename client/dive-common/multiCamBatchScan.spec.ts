import {
  CollectRawScan,
  CollectSubfolderScan,
  scanMultiCamBatchFromCollects,
} from 'dive-common/multiCamBatchScan';

function collectSubfolder(
  collectName: string,
  cameraName: string,
  imageCount: number,
  entryCount = imageCount,
): CollectSubfolderScan {
  return {
    folderName: cameraName,
    path: `/survey/${collectName}/${cameraName}`,
    entryCount,
    imageCount,
  };
}

function collectScan(
  name: string,
  subfolders: Record<string, CollectSubfolderScan>,
): CollectRawScan {
  return {
    name,
    path: `/survey/${name}`,
    subfolders: new Map(Object.entries(subfolders).map(([key, value]) => [key.toLowerCase(), value])),
  };
}

describe('multiCamBatchScan', () => {
  it('produces import args for every valid collect', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      collectScan('fl01', {
        EO: collectSubfolder('fl01', 'EO', 3),
        IR: collectSubfolder('fl01', 'IR', 3),
        UV: collectSubfolder('fl01', 'UV', 3),
      }),
      collectScan('fl02', {
        EO: collectSubfolder('fl02', 'EO', 2),
        IR: collectSubfolder('fl02', 'IR', 2),
        UV: collectSubfolder('fl02', 'UV', 2),
      }),
    ]);
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['EO', 'UV', 'IR']);
    expect(result.collects.map((c) => c.name)).toEqual(['fl01', 'fl02']);
    result.collects.forEach((collect) => {
      expect(collect.problems).toEqual([]);
      expect(collect.warnings).toEqual([]);
      expect(collect.importArgs).not.toBeNull();
      expect(collect.importArgs?.datasetName).toBe(collect.name);
      expect(collect.importArgs?.cameraOrder).toEqual(['EO', 'UV', 'IR']);
      expect(collect.importArgs?.type).toBe('image-sequence');
      expect(collect.importArgs?.defaultDisplay).toBe('EO');
      expect(collect.importArgs?.sourceList).toEqual({
        EO: { sourcePath: `/survey/${collect.name}/EO`, trackFile: '' },
        IR: { sourcePath: `/survey/${collect.name}/IR`, trackFile: '' },
        UV: { sourcePath: `/survey/${collect.name}/UV`, trackFile: '' },
      });
    });
  });

  it('flags a collect missing a camera folder without blocking others', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      collectScan('fl01', {
        EO: collectSubfolder('fl01', 'EO', 3),
        IR: collectSubfolder('fl01', 'IR', 3),
      }),
      collectScan('fl02', {
        EO: collectSubfolder('fl02', 'EO', 3),
      }),
    ]);
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['EO', 'IR']);
    const [fl01, fl02] = result.collects;
    expect(fl01.problems).toEqual([]);
    expect(fl01.importArgs).not.toBeNull();
    expect(fl02.problems).toEqual(['Missing camera folder "IR"']);
    expect(fl02.importArgs).toBeNull();
  });

  it('distinguishes empty camera folders from folders with no supported images', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      collectScan('fl01', {
        EO: collectSubfolder('fl01', 'EO', 2),
        IR: collectSubfolder('fl01', 'IR', 2),
      }),
      collectScan('fl02', {
        EO: collectSubfolder('fl02', 'EO', 2),
        IR: collectSubfolder('fl02', 'IR', 0, 0),
      }),
      collectScan('fl03', {
        EO: collectSubfolder('fl03', 'EO', 2),
        IR: collectSubfolder('fl03', 'IR', 0, 1),
      }),
    ]);
    const [, fl02, fl03] = result.collects;
    expect(fl02.problems).toEqual(['Camera folder "IR" is empty']);
    expect(fl03.problems).toEqual(['No supported images in camera folder "IR"']);
    expect(fl02.importArgs).toBeNull();
    expect(fl03.importArgs).toBeNull();
  });

  it('attaches discovered registration files to camera slots on importArgs', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      {
        ...collectScan('fl01', {
          EO: collectSubfolder('fl01', 'EO', 3),
          IR: collectSubfolder('fl01', 'IR', 3),
          UV: collectSubfolder('fl01', 'UV', 3),
        }),
        transformFiles: [
          '/survey/fl01/ir_to_eo_registration.json',
          '/survey/fl01/uv_to_eo_registration.json',
        ],
      },
    ]);
    const [fl01] = result.collects;
    expect(fl01.warnings).toEqual([]);
    expect(fl01.transformFiles).toEqual([
      'ir_to_eo_registration.json',
      'uv_to_eo_registration.json',
    ]);
    expect(fl01.importArgs?.sourceList.IR.transformFile)
      .toBe('/survey/fl01/ir_to_eo_registration.json');
    expect(fl01.importArgs?.sourceList.UV.transformFile)
      .toBe('/survey/fl01/uv_to_eo_registration.json');
    expect(fl01.importArgs?.sourceList.EO.transformFile).toBeUndefined();
  });

  it('warns about registration files that no free camera slot can carry', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      {
        ...collectScan('fl01', {
          EO: collectSubfolder('fl01', 'EO', 3),
          IR: collectSubfolder('fl01', 'IR', 3),
        }),
        transformFiles: [
          '/survey/fl01/ir_to_eo_registration.json',
          '/survey/fl01/extra_transforms.json',
        ],
      },
    ]);
    const [fl01] = result.collects;
    expect(fl01.transformFiles).toEqual(['ir_to_eo_registration.json']);
    expect(fl01.warnings).toEqual([
      'Registration file(s) not attached (no free camera slot): extra_transforms.json',
    ]);
    expect(fl01.importArgs).not.toBeNull();
  });

  it('warns (without blocking) on frame count mismatch between cameras', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      collectScan('fl01', {
        EO: collectSubfolder('fl01', 'EO', 3),
        IR: collectSubfolder('fl01', 'IR', 2),
      }),
    ]);
    const [fl01] = result.collects;
    expect(fl01.problems).toEqual([]);
    expect(fl01.warnings).toEqual(['Frame counts differ across cameras (EO: 3, IR: 2)']);
    expect(fl01.importArgs).not.toBeNull();
    expect(fl01.cameras.map((c) => c.imageCount)).toEqual([3, 2]);
  });

  it('reports a root problem when no collect folders exist', () => {
    const result = scanMultiCamBatchFromCollects('/survey', []);
    expect(result.problems).toEqual(['No collect folders found in /survey']);
    expect(result.collects).toEqual([]);
  });

  it('blocks all collects when fewer than two cameras are shared', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      collectScan('fl01', { EO: collectSubfolder('fl01', 'EO', 2) }),
      collectScan('fl02', { EO: collectSubfolder('fl02', 'EO', 2) }),
    ]);
    expect(result.problems).toEqual([
      'Expected 2 or 3 camera folders shared across collects, found 1 (EO)',
    ]);
    result.collects.forEach((collect) => {
      expect(collect.importArgs).toBeNull();
    });
  });

  it('rejects camera folder names that are not alphanumeric', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      collectScan('fl01', {
        'EO cam': collectSubfolder('fl01', 'EO cam', 2),
        IR: collectSubfolder('fl01', 'IR', 2),
      }),
    ]);
    expect(result.problems).toEqual([
      'Camera folder names must be letters and numbers only (no spaces): EO cam',
    ]);
    expect(result.collects[0].importArgs).toBeNull();
  });
});
