/// <reference types="vitest" />
import CameraCalibrationStore from './CameraCalibrationStore';

describe('CameraCalibrationStore', () => {
  it('produces a directional pairKey that preserves left/right order', () => {
    const store = new CameraCalibrationStore();
    expect(store.pairKey('rgb', 'ir')).toEqual('rgb::ir');
    expect(store.pairKey('rgb', 'ir')).not.toEqual(store.pairKey('ir', 'rgb'));
  });

  it('preserves the chosen left/right order on the active pair', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('rgb', 'ir');
    expect(store.activePair.value).toEqual({ camA: 'rgb', camB: 'ir' });
  });

  it('clears the active pair for identical or empty cameras', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('cam', 'cam');
    expect(store.activePair.value).toBeNull();
  });

  it('resets alignment to original when switching pairs', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    store.setPickTarget('ghost');
    expect(store.alignment.value.mode).toBe('AtoB');
    store.setActivePair('left', 'other');
    expect(store.alignment.value).toMatchObject({ mode: 'original', pickTarget: 'native' });
  });

  it('forms one correspondence from a blue->red two-click sequence', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [10, 20]); // pending (blue)
    expect(store.pendingPoint.value).not.toBeNull();
    expect(store.correspondences.value[key]).toBeUndefined();
    store.addPoint('right', [30, 40]); // completes (red)
    expect(store.pendingPoint.value).toBeNull();
    expect(store.correspondences.value[key]).toHaveLength(1);
    expect(store.correspondences.value[key][0]).toMatchObject({ a: [10, 20], b: [30, 40] });
  });

  it('maps points to a/b by camera regardless of click order', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('right', [30, 40]); // click right first
    store.addPoint('left', [10, 20]);
    expect(store.correspondences.value[key][0]).toMatchObject({ a: [10, 20], b: [30, 40] });
  });

  it('replaces the pending point when the same camera is clicked twice', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('left', [2, 2]);
    expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [2, 2] });
  });

  it('ignores points for cameras outside the active pair', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('other', [1, 1]);
    expect(store.pendingPoint.value).toBeNull();
  });

  it('removes a correspondence by id', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    const { id } = store.correspondences.value[key][0];
    store.removeCorrespondence(id);
    expect(store.correspondences.value[key]).toHaveLength(0);
  });

  it('moves one side of a correspondence via updateCorrespondencePoint', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    const { id } = store.correspondences.value[key][0];
    store.updateCorrespondencePoint(id, 'left', [5, 6]);
    expect(store.correspondences.value[key][0].a).toEqual([5, 6]);
    expect(store.correspondences.value[key][0].b).toEqual([2, 2]);
    store.updateCorrespondencePoint(id, 'right', [7, 8]);
    expect(store.correspondences.value[key][0].b).toEqual([7, 8]);
  });

  it('ignores updateCorrespondencePoint for unknown ids or cameras outside the pair', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    const { id } = store.correspondences.value[key][0];
    store.updateCorrespondencePoint(id + 99, 'left', [5, 6]);
    store.updateCorrespondencePoint(id, 'other', [5, 6]);
    expect(store.correspondences.value[key][0]).toMatchObject({ a: [1, 1], b: [2, 2] });
  });

  it('refits the pair homography when a point is drag-refined while alignment is active', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    const before = store.homographies.value[key].AtoB[0][2];
    const { id } = store.correspondences.value[key][0];
    store.updateCorrespondencePoint(id, 'right', [40, 40]);
    expect(store.homographies.value[key].AtoB[0][2]).not.toBeCloseTo(before, 5);
  });

  it('moves the pending point only for its own camera', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    store.movePendingPoint('right', [9, 9]);
    expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [1, 1] });
    store.movePendingPoint('left', [9, 9]);
    expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [9, 9] });
  });

  it('fits a homography from >= 4 pairs and stores both directions', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    // A pure translation by (5, -3).
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    pts.forEach((p) => {
      store.addPoint('left', p);
      store.addPoint('right', [p[0] + 5, p[1] - 3]);
    });
    const { AtoB, BtoA } = store.fitTransform(key);
    expect(AtoB[0][2]).toBeCloseTo(5, 5);
    expect(AtoB[1][2]).toBeCloseTo(-3, 5);
    expect(BtoA[0][2]).toBeCloseTo(-5, 5);
    expect(store.homographies.value[key]).toBeDefined();
  });

  it('throws when fitting with fewer than 4 pairs (default homography type)', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    expect(() => store.fitTransform(key)).toThrow();
  });

  it('surfaces a fitError instead of throwing when maybeFitPair hits a degenerate configuration', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    // 4 collinear points satisfy the homography minimum count but are degenerate.
    const pts: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]];
    pts.forEach((p) => {
      store.addPoint('left', p);
      store.addPoint('right', p);
    });
    expect(() => store.maybeFitPair(key)).not.toThrow();
    expect(store.fitError.value).toMatch(/degenerate/i);
    expect(store.homographies.value[key]).toBeUndefined();
  });

  it('clears a stale fitError once the active pair fits successfully', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    const collinear: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]];
    collinear.forEach((p) => {
      store.addPoint('left', p);
      store.addPoint('right', p);
    });
    store.maybeFitPair(key);
    expect(store.fitError.value).not.toBeNull();
    store.clearPair();
    addFourTranslationPairs(store);
    store.maybeFitPair(key);
    expect(store.fitError.value).toBeNull();
    expect(store.homographies.value[key]).toBeDefined();
  });

  it('clears fitError when switching to a different active pair', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    const collinear: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]];
    collinear.forEach((p) => {
      store.addPoint('left', p);
      store.addPoint('right', p);
    });
    store.maybeFitPair(key);
    expect(store.fitError.value).not.toBeNull();
    store.setActivePair('left', 'other');
    expect(store.fitError.value).toBeNull();
  });

  function addFourTranslationPairs(store: CameraCalibrationStore) {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    pts.forEach((p) => {
      store.addPoint('left', p);
      store.addPoint('right', [p[0] + 5, p[1] - 3]);
    });
  }

  it('fits when enabling alignment mode with >= 4 pairs', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    expect(store.alignment.value.mode).toBe('AtoB');
    expect(store.homographies.value[key]).toBeDefined();
    expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5, 5);
  });

  it('does not enable alignment mode with fewer than 4 pairs (default homography type)', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    store.setAlignmentMode('AtoB');
    expect(store.alignment.value.mode).toBe('original');
    expect(store.homographies.value).toEqual({});
  });

  it('refits when correspondences change while alignment mode is active', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    const before = store.homographies.value[key].AtoB[0][2];
    store.addPoint('left', [20, 20]);
    store.addPoint('right', [30, 14]);
    expect(store.homographies.value[key].AtoB[0][2]).not.toBeCloseTo(before, 5);
  });

  it('reverts alignment to original when correspondences drop below the transform minimum', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    const { id } = store.correspondences.value[key][0];
    store.removeCorrespondence(id);
    store.removeCorrespondence(store.correspondences.value[key][0].id);
    store.removeCorrespondence(store.correspondences.value[key][0].id);
    store.removeCorrespondence(store.correspondences.value[key][0].id);
    expect(store.correspondences.value[key]).toHaveLength(0);
    expect(store.alignment.value.mode).toBe('original');
    expect(store.homographies.value[key]).toBeUndefined();
  });

  it('maybeFitActivePair fits without enabling alignment mode', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.maybeFitActivePair();
    expect(store.alignment.value.mode).toBe('original');
    expect(store.homographies.value[key]).toBeDefined();
  });

  it('hydrates homographies and resets transient state', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    const saved = { 'a::b': { AtoB: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], BtoA: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } };
    store.hydrate(saved);
    expect(store.homographies.value).toEqual(saved);
    expect(store.activePair.value).toBeNull();
    expect(store.pendingPoint.value).toBeNull();
    expect(store.correspondences.value).toEqual({});
    expect(store.transformTypes.value).toEqual({});
    expect(store.alignment.value).toEqual({ mode: 'original', opacity: 0.5, pickTarget: 'native' });
  });

  it('hydrates transform types alongside homographies', () => {
    const store = new CameraCalibrationStore();
    store.hydrate({}, {}, { 'a::b': 'rigid' });
    expect(store.transformTypeForPair('a::b')).toBe('rigid');
    expect(store.transformTypeForPair('unset::pair')).toBe('homography');
  });

  it('hydrates correspondences and resumes id allocation', () => {
    const store = new CameraCalibrationStore();
    const correspondences = {
      'rgb::ir': [
        { id: 1, a: [1, 2], b: [3, 4] },
        { id: 2, a: [5, 6], b: [7, 8] },
      ],
    };
    store.hydrate({}, correspondences);
    expect(store.correspondences.value).toEqual(correspondences);
    // New points pick up after the highest restored id.
    store.setActivePair('rgb', 'ir');
    store.addPoint('rgb', [9, 9]);
    store.addPoint('ir', [10, 10]);
    expect(store.correspondences.value['rgb::ir'][2].id).toBe(3);
  });

  describe('transform type selection', () => {
    it('fits a rigid transform from 2 pairs where the default homography type would throw', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [0, 0]);
      store.addPoint('right', [5, -3]);
      store.addPoint('left', [10, 0]);
      store.addPoint('right', [15, -3]);
      expect(() => store.fitTransform(key)).toThrow();
      store.setTransformType(key, 'rigid');
      expect(store.homographies.value[key]).toBeDefined();
      expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5, 4);
    });

    it('clears the fit and reverts alignment when switching to a type needing more points than are picked', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [0, 0]);
      store.addPoint('right', [5, -3]);
      store.addPoint('left', [10, 0]);
      store.addPoint('right', [15, -3]);
      store.setTransformType(key, 'rigid');
      store.setAlignmentMode('AtoB');
      expect(store.alignment.value.mode).toBe('AtoB');

      store.setTransformType(key, 'homography'); // needs 4, only 2 picked
      expect(store.homographies.value[key]).toBeUndefined();
      expect(store.alignment.value.mode).toBe('original');
    });
  });

  describe('setAlignmentMode / setPickTarget guards', () => {
    it('setPickTarget is a no-op while alignment mode is original', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.setPickTarget('ghost');
      expect(store.alignment.value.pickTarget).toBe('native');
    });

    it('setAlignmentMode leaves mode original when the pair lacks enough points', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.setAlignmentMode('BtoA');
      expect(store.alignment.value.mode).toBe('original');
    });
  });

  describe('pickPoint', () => {
    it('attributes a ghost-pane click to the source camera via the inverse homography', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store); // left -> right is +5, -3
      store.setAlignmentMode('AtoB'); // ghost of left shown in right's pane
      store.setPickTarget('ghost');
      store.pickPoint('right', [15, 7]);
      expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [10, 10] });
    });

    it('always records a native pick in the non-ghosted (source) pane', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      store.setAlignmentMode('AtoB'); // right is the ghosted/destination pane
      store.setPickTarget('ghost');
      store.pickPoint('left', [3, 4]); // clicking the source pane, not ghosted
      expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [3, 4] });
    });

    it('records a native pick in the ghosted pane when pick target is native', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      store.setAlignmentMode('AtoB');
      // pickTarget defaults to 'native'
      store.pickPoint('right', [15, 7]);
      expect(store.pendingPoint.value).toMatchObject({ camera: 'right', coord: [15, 7] });
    });

    it('behaves exactly like addPoint when alignment mode is original', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.pickPoint('right', [15, 7]);
      expect(store.pendingPoint.value).toMatchObject({ camera: 'right', coord: [15, 7] });
    });
  });

  describe('correspondence selection', () => {
    function storeWithOnePair() {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      const key = store.pairKey('left', 'right');
      const { id } = store.correspondences.value[key][0];
      return { store, key, id };
    }

    it('selects an active-pair correspondence and clears via null or unknown ids', () => {
      const { store, id } = storeWithOnePair();
      store.selectCorrespondence(id);
      expect(store.selectedCorrespondenceId.value).toBe(id);
      store.selectCorrespondence(id + 99);
      expect(store.selectedCorrespondenceId.value).toBeNull();
      store.selectCorrespondence(id);
      store.selectCorrespondence(null);
      expect(store.selectedCorrespondenceId.value).toBeNull();
    });

    it('removeSelectedCorrespondence removes both cameras\' points and clears the selection', () => {
      const { store, key, id } = storeWithOnePair();
      store.selectCorrespondence(id);
      store.removeSelectedCorrespondence();
      expect(store.correspondences.value[key]).toHaveLength(0);
      expect(store.selectedCorrespondenceId.value).toBeNull();
      // No selection: a further call is a no-op.
      store.removeSelectedCorrespondence();
      expect(store.correspondences.value[key]).toHaveLength(0);
    });

    it('clears the selection when the selected pair is removed, undone, or the pair switches', () => {
      const first = storeWithOnePair();
      first.store.selectCorrespondence(first.id);
      first.store.removeCorrespondence(first.id);
      expect(first.store.selectedCorrespondenceId.value).toBeNull();

      const second = storeWithOnePair();
      second.store.selectCorrespondence(second.id);
      second.store.clearLast();
      expect(second.store.selectedCorrespondenceId.value).toBeNull();

      const third = storeWithOnePair();
      third.store.selectCorrespondence(third.id);
      third.store.setActivePair('left', 'other');
      expect(third.store.selectedCorrespondenceId.value).toBeNull();
    });

    it('clears the selection on clearPair and hydrate', () => {
      const { store, id } = storeWithOnePair();
      store.selectCorrespondence(id);
      store.clearPair();
      expect(store.selectedCorrespondenceId.value).toBeNull();

      const hydrated = storeWithOnePair();
      hydrated.store.selectCorrespondence(hydrated.id);
      hydrated.store.hydrate();
      expect(hydrated.store.selectedCorrespondenceId.value).toBeNull();
    });
  });

  describe('loadCalibrationText', () => {
    const fileText = (pairs: unknown[]) => JSON.stringify({
      type: 'dive-camera-calibration', version: 1, pairs,
    });

    it('loads points and transform type and derives the missing matrix direction', () => {
      const store = new CameraCalibrationStore();
      const { cameras, pairCount } = store.loadCalibrationText(fileText([{
        left: 'rgb',
        right: 'ir',
        transformType: 'rigid',
        points: [[1, 2, 3, 4]],
        rightToLeft: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
      }]));
      const key = store.pairKey('rgb', 'ir');
      expect(pairCount).toBe(1);
      expect(cameras).toEqual(expect.arrayContaining(['rgb', 'ir']));
      expect(store.correspondences.value[key]).toHaveLength(1);
      expect(store.transformTypeForPair(key)).toBe('rigid');
      expect(store.homographies.value[key].BtoA).toEqual([[1, 0, -5], [0, 1, 3], [0, 0, 1]]);
      expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5);
    });

    it('throws on non-JSON and on a missing pairs list, leaving state untouched', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('rgb', 'ir');
      store.addPoint('rgb', [1, 1]);
      store.addPoint('ir', [2, 2]);
      expect(() => store.loadCalibrationText('not json')).toThrow('valid JSON');
      expect(() => store.loadCalibrationText('{}')).toThrow('pairs');
      expect(store.correspondences.value[store.pairKey('rgb', 'ir')]).toHaveLength(1);
    });

    it('rejects a singular matrix without mutating state', () => {
      const store = new CameraCalibrationStore();
      expect(() => store.loadCalibrationText(fileText([{
        left: 'a', right: 'b', leftToRight: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      }]))).toThrow(/singular/);
      expect(store.homographies.value).toEqual({});
    });

    it('clears the selection', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('rgb', 'ir');
      store.addPoint('rgb', [1, 1]);
      store.addPoint('ir', [2, 2]);
      store.selectCorrespondence(store.correspondences.value[store.pairKey('rgb', 'ir')][0].id);
      store.loadCalibrationText(fileText([]));
      expect(store.selectedCorrespondenceId.value).toBeNull();
    });
  });

  describe('linked navigation', () => {
    it('setLinkedNav toggles the flag', () => {
      const store = new CameraCalibrationStore();
      expect(store.linkedNav.value).toBe(false);
      store.setLinkedNav(true);
      expect(store.linkedNav.value).toBe(true);
      store.setLinkedNav(false);
      expect(store.linkedNav.value).toBe(false);
    });

    it('linkedPoint maps a point from camA to camB and back, via the fitted homography', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store); // left -> right is +5, -3
      store.maybeFitActivePair();
      const fromLeft = store.linkedPoint('left', [1, 1]);
      expect(fromLeft).toMatchObject({ camera: 'right', coord: [6, -2] });
      const fromRight = store.linkedPoint('right', [6, -2]);
      expect(fromRight).toMatchObject({ camera: 'left', coord: [1, 1] });
    });

    it('linkedPoint returns null when the pair has no fitted homography yet', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      expect(store.linkedPoint('left', [1, 1])).toBeNull();
    });

    it('linkedPoint returns null for a camera outside the active pair', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      expect(store.linkedPoint('other', [1, 1])).toBeNull();
    });

    it('resets linkedNav on hydrate', () => {
      const store = new CameraCalibrationStore();
      store.setLinkedNav(true);
      store.hydrate();
      expect(store.linkedNav.value).toBe(false);
    });
  });

  describe('cursor coordinate readout', () => {
    it('records and clears the cursor coordinate', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.setCursorCoord('left', [12, 34]);
      expect(store.cursorCoord.value).toEqual({ camera: 'left', coord: [12, 34] });
      store.clearCursorCoord();
      expect(store.cursorCoord.value).toBeNull();
    });

    it('clears the cursor coordinate when switching pairs', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.setCursorCoord('left', [12, 34]);
      store.setActivePair('left', 'other');
      expect(store.cursorCoord.value).toBeNull();
    });
  });

  describe('clearLast', () => {
    it('drops the pending point without touching completed correspondences', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      store.addPoint('left', [3, 3]); // pending
      store.clearLast();
      expect(store.pendingPoint.value).toBeNull();
      expect(store.correspondences.value[key]).toHaveLength(1);
    });

    it('removes the last completed correspondence when there is no pending point', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      store.addPoint('left', [3, 3]);
      store.addPoint('right', [4, 4]);
      store.clearLast();
      expect(store.correspondences.value[key]).toHaveLength(1);
      expect(store.correspondences.value[key][0]).toMatchObject({ a: [1, 1], b: [2, 2] });
    });

    it('is a no-op with nothing to undo', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      expect(() => store.clearLast()).not.toThrow();
      store.clearLast();
      expect(store.pendingPoint.value).toBeNull();
    });

    it('refits when clearing last while alignment mode is active', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      addFourTranslationPairs(store);
      store.setAlignmentMode('AtoB');
      store.clearLast();
      expect(store.correspondences.value[key]).toHaveLength(3);
      expect(store.alignment.value.mode).toBe('original');
      expect(store.homographies.value[key]).toBeUndefined();
    });
  });

  describe('requestRecenter', () => {
    it('records a recenter request for a camera in the active pair', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('right', [7, 8]);
      expect(store.recenterRequest.value).toMatchObject({ camera: 'right', coord: [7, 8] });
    });

    it('ignores a recenter request for a camera outside the active pair', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('other', [7, 8]);
      expect(store.recenterRequest.value).toBeNull();
    });

    it('assigns a new id to each request so repeated identical requests still change', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('left', [1, 1]);
      const firstId = store.recenterRequest.value?.id;
      store.requestRecenter('left', [1, 1]);
      expect(store.recenterRequest.value?.id).not.toBe(firstId);
    });

    it('clears the recenter request when switching pairs', () => {
      const store = new CameraCalibrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('left', [1, 1]);
      store.setActivePair('left', 'other');
      expect(store.recenterRequest.value).toBeNull();
    });
  });
});
