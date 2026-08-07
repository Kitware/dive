import { CollectSubfolderScan } from './multiCamBatchScan';
import {
  StereoBatchRawScan,
  StereoCollectRawScan,
  scanStereoBatchFromScan,
} from './stereoBatchScan';

function subfolders(
  root: string,
  entries: [string, number][],
): Map<string, CollectSubfolderScan> {
  const map = new Map<string, CollectSubfolderScan>();
  entries.forEach(([folderName, imageCount]) => {
    map.set(folderName.toLowerCase(), {
      folderName,
      path: `${root}/${folderName}`,
      entryCount: imageCount,
      imageCount,
    });
  });
  return map;
}

function collect(
  name: string,
  entries: [string, number][],
  extra: Partial<StereoCollectRawScan> = {},
): StereoCollectRawScan {
  const path = `/survey/${name}`;
  return {
    name,
    path,
    subfolders: subfolders(path, entries),
    ...extra,
  };
}

function scan(raw: Partial<StereoBatchRawScan>) {
  return scanStereoBatchFromScan({ rootPath: '/survey', collects: [], ...raw });
}

describe('scanStereoBatchFromScan', () => {
  it('resolves left/right camera folders per collect', () => {
    const result = scan({
      collects: [
        collect('collect1', [['left', 10], ['right', 10]]),
        collect('collect2', [['left', 8], ['right', 8]]),
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['left', 'right']);
    expect(result.collects).toHaveLength(2);
    const [first] = result.collects;
    expect(first.importArgs?.sourceList.left.sourcePath).toBe('/survey/collect1/left');
    expect(first.importArgs?.sourceList.right.sourcePath).toBe('/survey/collect1/right');
    expect(first.importArgs?.defaultDisplay).toBe('left');
    expect(first.importArgs?.type).toBe('image-sequence');
  });

  it('resolves marker suffixed camera folders', () => {
    const result = scan({
      collects: [collect('collect1', [['cam_L', 5], ['cam_R', 5]])],
    });
    expect(result.collects[0].importArgs?.sourceList.left.sourcePath)
      .toBe('/survey/collect1/cam_L');
    expect(result.collects[0].importArgs?.sourceList.right.sourcePath)
      .toBe('/survey/collect1/cam_R');
  });

  it('falls back to listing order for exactly two unnamed camera folders', () => {
    const result = scan({
      collects: [collect('collect1', [['camA', 5], ['camB', 5]])],
    });
    const [first] = result.collects;
    expect(first.importArgs?.sourceList.left.sourcePath).toBe('/survey/collect1/camA');
    expect(first.importArgs?.sourceList.right.sourcePath).toBe('/survey/collect1/camB');
    expect(first.warnings.join(' ')).toContain('do not identify sides');
  });

  it('blocks a collect with three unnamed camera folders', () => {
    const result = scan({
      collects: [collect('collect1', [['eo', 5], ['ir', 5], ['uv', 5]])],
    });
    expect(result.collects[0].importArgs).toBeNull();
    expect(result.collects[0].problems.join(' ')).toContain('No left and right camera folders');
    expect(result.problems.join(' ')).toContain('No stereo datasets found');
  });

  it('pairs videos inside a collect folder', () => {
    const result = scan({
      collects: [collect('collect1', [], {
        videoFiles: [
          { name: 'a_left.mp4', path: '/survey/collect1/a_left.mp4' },
          { name: 'a_right.mp4', path: '/survey/collect1/a_right.mp4' },
        ],
      })],
    });
    const [first] = result.collects;
    expect(first.importArgs?.type).toBe('video');
    expect(first.importArgs?.sourceList.left.sourcePath).toBe('/survey/collect1/a_left.mp4');
  });

  it('pairs sibling videos in the root into one dataset each', () => {
    const result = scan({
      rootVideoFiles: [
        { name: 'dive01_left.mp4', path: '/survey/dive01_left.mp4' },
        { name: 'dive01_right.mp4', path: '/survey/dive01_right.mp4' },
        { name: 'dive02_L.mp4', path: '/survey/dive02_L.mp4' },
        { name: 'dive02_R.mp4', path: '/survey/dive02_R.mp4' },
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.collects.map((c) => c.name)).toEqual(['dive01', 'dive02']);
    expect(result.collects[1].importArgs?.sourceList.right.sourcePath)
      .toBe('/survey/dive02_R.mp4');
  });

  it('pairs sibling image folders in the root', () => {
    const result = scan({
      collects: [
        collect('run_L', [], { imageCount: 12 }),
        collect('run_R', [], { imageCount: 12 }),
      ],
    });
    expect(result.collects).toHaveLength(1);
    expect(result.collects[0].name).toBe('run');
    expect(result.collects[0].importArgs?.sourceList.left.sourcePath).toBe('/survey/run_L');
  });

  it('descends into L/R named folders that hold no images of their own', () => {
    const result = scan({
      collects: [
        collect('run_L', [['left', 4], ['right', 4]]),
        collect('run_R', [['left', 4], ['right', 4]]),
      ],
    });
    expect(result.collects.map((c) => c.name)).toEqual(['run_L', 'run_R']);
    expect(result.collects[0].importArgs?.sourceList.left.sourcePath)
      .toBe('/survey/run_L/left');
  });

  it('attaches a collect calibration file and falls back to the root one', () => {
    const result = scan({
      collects: [
        collect('collect1', [['left', 4], ['right', 4]], {
          calibrationFile: '/survey/collect1/calibration.npz',
        }),
        collect('collect2', [['left', 4], ['right', 4]]),
      ],
      rootCalibrationFile: '/survey/shared_calibration.npz',
    });
    expect(result.collects[0].importArgs?.calibrationFile)
      .toBe('/survey/collect1/calibration.npz');
    expect(result.collects[1].importArgs?.calibrationFile)
      .toBe('/survey/shared_calibration.npz');
  });

  it('warns when no calibration file is found', () => {
    const result = scan({
      collects: [collect('collect1', [['left', 4], ['right', 4]])],
    });
    expect(result.collects[0].warnings.join(' ')).toContain('No stereo calibration file');
  });

  it('warns when frame counts differ', () => {
    const result = scan({
      collects: [collect('collect1', [['left', 10], ['right', 8]])],
    });
    expect(result.collects[0].warnings.join(' ')).toContain('Frame counts differ');
  });

  it('reports an empty root', () => {
    const result = scan({});
    expect(result.problems.join(' ')).toContain('No folders or videos found');
  });

  it('keeps importable collects alongside blocked ones', () => {
    const result = scan({
      collects: [
        collect('good', [['left', 4], ['right', 4]]),
        collect('bad', [['eo', 4], ['ir', 4], ['uv', 4]]),
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.collects.find((c) => c.name === 'good')?.importArgs).not.toBeNull();
    expect(result.collects.find((c) => c.name === 'bad')?.importArgs).toBeNull();
  });
});
