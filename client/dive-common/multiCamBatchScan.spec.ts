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
  rootImageNames?: string[],
): CollectRawScan {
  return {
    name,
    path: `/survey/${name}`,
    subfolders: new Map(Object.entries(subfolders).map(([key, value]) => [key.toLowerCase(), value])),
    ...(rootImageNames ? { rootImageNames } : {}),
  };
}

function viewFrameName(view: string, second: string, modality: string, ext = 'jpg'): string {
  return `fl09_${view}_20240612_2041${second}.625730_${modality}.${ext}`;
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

  it('infers modality cameras for flat view-folder collects', () => {
    const result = scanMultiCamBatchFromCollects('/survey/fl09', [
      collectScan('center_view', {}, [
        viewFrameName('C', '07', 'rgb'),
        viewFrameName('C', '08', 'rgb'),
        viewFrameName('C', '07', 'ir', 'tif'),
        viewFrameName('C', '07', 'uv'),
      ]),
      collectScan('left_view', {}, [
        viewFrameName('L', '07', 'rgb'),
        viewFrameName('L', '07', 'ir', 'tif'),
      ]),
    ]);
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['rgb', 'ir', 'uv']);

    const [center, left] = result.collects;
    expect(center.problems).toEqual([]);
    expect(center.warnings).toEqual([]);
    expect(center.cameras.map((c) => [c.name, c.imageCount, c.glob])).toEqual([
      ['rgb', 2, '*_rgb.*'],
      ['ir', 1, '*_ir.*'],
      ['uv', 1, '*_uv.*'],
    ]);
    expect(center.importArgs).toEqual({
      datasetName: 'fl09_center_view',
      defaultDisplay: 'rgb',
      cameraOrder: ['rgb', 'ir', 'uv'],
      sourceList: {
        rgb: { sourcePath: '/survey/center_view', trackFile: '', glob: '*_rgb.*' },
        ir: { sourcePath: '/survey/center_view', trackFile: '', glob: '*_ir.*' },
        uv: { sourcePath: '/survey/center_view', trackFile: '', glob: '*_uv.*' },
      },
      type: 'image-sequence',
    });
    expect(left.importArgs?.datasetName).toBe('fl09_left_view');
    expect(left.importArgs?.cameraOrder).toEqual(['rgb', 'ir']);
  });

  it('imports a single-modality view-folder collect with a warning', () => {
    const result = scanMultiCamBatchFromCollects('/survey/fl09', [
      collectScan('right_view', {}, [
        viewFrameName('R', '07', 'rgb'),
        viewFrameName('R', '08', 'rgb'),
      ]),
    ]);
    expect(result.problems).toEqual([]);
    const [right] = result.collects;
    expect(right.warnings).toEqual([
      'Only one modality (rgb) found; the dataset will have a single camera',
    ]);
    expect(right.importArgs?.cameraOrder).toEqual(['rgb']);
    expect(right.importArgs?.defaultDisplay).toBe('rgb');
  });

  it('does not treat non-conforming flat images or subfolder collects as view folders', () => {
    const result = scanMultiCamBatchFromCollects('/survey', [
      // subfolder collect with stray modality-suffixed files at its root stays subfolder-based
      collectScan('fl01', {
        EO: collectSubfolder('fl01', 'EO', 2),
        IR: collectSubfolder('fl01', 'IR', 2),
      }, [viewFrameName('C', '07', 'rgb')]),
      // flat collect whose images lack modality suffixes gets the usual problems
      collectScan('fl02', {}, ['frame_000001.jpg', 'frame_000002.jpg']),
    ]);
    const [fl01, fl02] = result.collects;
    expect(fl01.cameras.map((c) => c.name)).toEqual(['EO', 'IR']);
    expect(fl01.importArgs?.sourceList.EO.glob).toBeUndefined();
    expect(fl02.importArgs).toBeNull();
    expect(fl02.problems.length).toBeGreaterThan(0);
  });

  it('keeps view-folder collects importable when subfolder collects fail shared validation', () => {
    const result = scanMultiCamBatchFromCollects('/survey/fl09', [
      collectScan('fl01', { EO: collectSubfolder('fl01', 'EO', 2) }),
      collectScan('center_view', {}, [
        viewFrameName('C', '07', 'rgb'),
        viewFrameName('C', '07', 'ir', 'tif'),
      ]),
    ]);
    expect(result.problems).toEqual([
      'Expected 2 or 3 camera folders shared across collects, found 1 (EO)',
    ]);
    const [fl01, center] = result.collects;
    expect(fl01.importArgs).toBeNull();
    expect(center.importArgs).not.toBeNull();
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
