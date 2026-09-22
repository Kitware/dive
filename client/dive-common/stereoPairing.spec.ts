import {
  detectStereoSideByCharDiff,
  detectStereoSideToken,
  pairStereoNames,
} from './stereoPairing';

const names = (list: string[]) => pairStereoNames(list, (name) => name);

describe('detectStereoSideToken', () => {
  it('matches bare left and right', () => {
    expect(detectStereoSideToken('left')).toEqual({ stem: '', side: 'left' });
    expect(detectStereoSideToken('RIGHT')).toEqual({ stem: '', side: 'right' });
  });

  it('matches delimited markers of any case', () => {
    expect(detectStereoSideToken('dive01_L.mp4')).toEqual({ stem: 'dive01', side: 'left' });
    expect(detectStereoSideToken('dive01-Right.mp4')).toEqual({ stem: 'dive01', side: 'right' });
    expect(detectStereoSideToken('cam l 02')).toEqual({ stem: 'cam_02', side: 'left' });
  });

  it('does not match substrings inside other tokens', () => {
    expect(detectStereoSideToken('cam_ir')).toBeNull();
    expect(detectStereoSideToken('rgb')).toBeNull();
    expect(detectStereoSideToken('lateral')).toBeNull();
  });

  it('rejects names carrying both markers', () => {
    expect(detectStereoSideToken('left_right')).toBeNull();
  });
});

describe('detectStereoSideByCharDiff', () => {
  it('matches a glued single character marker', () => {
    expect(detectStereoSideByCharDiff('camL.mp4', 'camR.mp4'))
      .toEqual({ stem: 'cam', leftFirst: true });
    expect(detectStereoSideByCharDiff('camR.mp4', 'camL.mp4'))
      .toEqual({ stem: 'cam', leftFirst: false });
  });

  it('ignores differences that are not L/R', () => {
    expect(detectStereoSideByCharDiff('camA.mp4', 'camB.mp4')).toBeNull();
  });

  it('ignores names differing in more than one character', () => {
    expect(detectStereoSideByCharDiff('camLL.mp4', 'camRR.mp4')).toBeNull();
  });
});

describe('pairStereoNames', () => {
  it('pairs left and right folders', () => {
    const result = names(['left', 'right']);
    expect(result.pairs).toEqual([{ stem: '', left: 'left', right: 'right' }]);
    expect(result.unpaired).toEqual([]);
  });

  it('pairs multiple sibling video pairs by stem', () => {
    const result = names([
      'dive01_left.mp4', 'dive01_right.mp4', 'dive02_left.mp4', 'dive02_right.mp4',
    ]);
    expect(result.pairs).toEqual([
      { stem: 'dive01', left: 'dive01_left.mp4', right: 'dive01_right.mp4' },
      { stem: 'dive02', left: 'dive02_left.mp4', right: 'dive02_right.mp4' },
    ]);
    expect(result.unpaired).toEqual([]);
  });

  it('pairs across differing extensions and marker spellings', () => {
    const result = names(['run_L.mp4', 'run_r.avi']);
    expect(result.pairs).toEqual([{ stem: 'run', left: 'run_L.mp4', right: 'run_r.avi' }]);
  });

  it('falls back to single character difference', () => {
    const result = names(['camL.mp4', 'camR.mp4']);
    expect(result.pairs).toEqual([{ stem: 'cam', left: 'camL.mp4', right: 'camR.mp4' }]);
  });

  it('leaves a lone side unpaired', () => {
    const result = names(['dive01_left.mp4', 'dive02_right.mp4']);
    expect(result.pairs).toEqual([]);
    expect(result.unpaired).toEqual(['dive01_left.mp4', 'dive02_right.mp4']);
  });

  it('leaves duplicate sides for one stem unpaired', () => {
    const result = names(['a_left.mp4', 'a_l.mp4', 'a_right.mp4']);
    expect(result.pairs).toEqual([]);
    expect(result.unpaired).toHaveLength(3);
  });

  it('does not pair EO/IR style folders', () => {
    const result = names(['eo', 'ir']);
    expect(result.pairs).toEqual([]);
    expect(result.unpaired).toEqual(['eo', 'ir']);
  });
});
