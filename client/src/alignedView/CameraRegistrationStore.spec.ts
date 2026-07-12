/// <reference types="vitest" />
import CameraRegistrationStore from './CameraRegistrationStore';
import { buildPerCameraRegistrationFiles } from './cameraRegistrationFiles';

/**
 * Serialize a store's state through the production per-camera serializer
 * (buildPerCameraRegistrationFiles) -- the only registration file format --
 * and return the single resulting file body as JSON text for round trips.
 */
function toSingleFileJson(store: CameraRegistrationStore): string {
  const files = buildPerCameraRegistrationFiles({
    homographies: store.homographies.value,
    correspondences: store.correspondences.value,
    transformTypes: store.transformTypes.value,
    source: store.source.value,
  }, null);
  expect(files).toHaveLength(1);
  return JSON.stringify(files[0].body);
}

describe('CameraRegistrationStore', () => {
  it('produces a directional pairKey that preserves left/right order', () => {
    const store = new CameraRegistrationStore();
    expect(store.pairKey('rgb', 'ir')).toEqual('rgb::ir');
    expect(store.pairKey('rgb', 'ir')).not.toEqual(store.pairKey('ir', 'rgb'));
  });

  it('preserves the chosen left/right order on the active pair', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('rgb', 'ir');
    expect(store.activePair.value).toEqual({ camA: 'rgb', camB: 'ir' });
  });

  it('clears the active pair for identical or empty cameras', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('cam', 'cam');
    expect(store.activePair.value).toBeNull();
  });

  it('resets alignment to original when switching pairs', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    expect(store.alignment.value.mode).toBe('AtoB');
    store.setActivePair('left', 'other');
    expect(store.alignment.value).toMatchObject({ mode: 'original' });
  });

  it('forms one correspondence from a blue->red two-click sequence', () => {
    const store = new CameraRegistrationStore();
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
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('right', [30, 40]); // click right first
    store.addPoint('left', [10, 20]);
    expect(store.correspondences.value[key][0]).toMatchObject({ a: [10, 20], b: [30, 40] });
  });

  it('replaces the pending point when the same camera is clicked twice', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('left', [2, 2]);
    expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [2, 2] });
  });

  it('ignores points for cameras outside the active pair', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('other', [1, 1]);
    expect(store.pendingPoint.value).toBeNull();
  });

  it('removes a correspondence by id', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    const { id } = store.correspondences.value[key][0];
    store.removeCorrespondence(id);
    expect(store.correspondences.value[key]).toHaveLength(0);
  });

  it('moves one side of a correspondence via updateCorrespondencePoint', () => {
    const store = new CameraRegistrationStore();
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
    const store = new CameraRegistrationStore();
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
    const store = new CameraRegistrationStore();
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
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    store.movePendingPoint('right', [9, 9]);
    expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [1, 1] });
    store.movePendingPoint('left', [9, 9]);
    expect(store.pendingPoint.value).toMatchObject({ camera: 'left', coord: [9, 9] });
  });

  it('fits a homography from >= 4 pairs and stores both directions', () => {
    const store = new CameraRegistrationStore();
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
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    expect(() => store.fitTransform(key)).toThrow();
  });

  it('surfaces a fitError instead of throwing when maybeFitPair hits a degenerate configuration', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.setTransformType(key, 'homography');
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
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.setTransformType(key, 'homography');
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
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.setTransformType(key, 'homography');
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

  function addFourTranslationPairs(store: CameraRegistrationStore) {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    pts.forEach((p) => {
      store.addPoint('left', p);
      store.addPoint('right', [p[0] + 5, p[1] - 3]);
    });
  }

  it('fits when enabling alignment mode with >= 4 pairs', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    expect(store.alignment.value.mode).toBe('AtoB');
    expect(store.homographies.value[key]).toBeDefined();
    expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5, 5);
  });

  it('does not enable alignment mode with fewer than 4 pairs (default homography type)', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    store.setAlignmentMode('AtoB');
    expect(store.alignment.value.mode).toBe('original');
    expect(store.homographies.value).toEqual({});
  });

  it('refits when correspondences change while alignment mode is active', () => {
    const store = new CameraRegistrationStore();
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
    const store = new CameraRegistrationStore();
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
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.maybeFitActivePair();
    expect(store.alignment.value.mode).toBe('original');
    expect(store.homographies.value[key]).toBeDefined();
  });

  it('hydrates homographies and resets transient state', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    const saved = { 'a::b': { AtoB: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], BtoA: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } };
    store.hydrate(saved);
    expect(store.homographies.value).toEqual(saved);
    expect(store.activePair.value).toBeNull();
    expect(store.pendingPoint.value).toBeNull();
    expect(store.correspondences.value).toEqual({});
    expect(store.transformTypes.value).toEqual({});
    expect(store.alignment.value).toEqual({ mode: 'original', opacity: 0.5 });
  });

  it('hydrates transform types alongside homographies', () => {
    const store = new CameraRegistrationStore();
    store.hydrate({}, {}, { 'a::b': 'rigid' });
    expect(store.transformTypeForPair('a::b')).toBe('rigid');
    expect(store.transformTypeForPair('unset::pair')).toBe('similarity');
  });

  it('hydrates correspondences and resumes id allocation', () => {
    const store = new CameraRegistrationStore();
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
    it('fits a rigid transform from 2 pairs where a homography would throw', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [0, 0]);
      store.addPoint('right', [5, -3]);
      store.addPoint('left', [10, 0]);
      store.addPoint('right', [15, -3]);
      store.setTransformType(key, 'homography');
      expect(() => store.fitTransform(key)).toThrow();
      store.setTransformType(key, 'rigid');
      expect(store.homographies.value[key]).toBeDefined();
      expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5, 4);
    });

    it('clears the fit and reverts alignment when switching to a type needing more points than are picked', () => {
      const store = new CameraRegistrationStore();
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

  describe('setAlignmentMode guards', () => {
    it('setAlignmentMode leaves mode original when the pair lacks enough points', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.setAlignmentMode('BtoA');
      expect(store.alignment.value.mode).toBe('original');
    });
  });

  describe('pickPoint', () => {
    it('records a native pick like addPoint in the Picking (original) mode', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.pickPoint('right', [15, 7]);
      expect(store.pendingPoint.value).toMatchObject({ camera: 'right', coord: [15, 7] });
    });

    it('is a no-op while an overlay warp is active', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      store.setAlignmentMode('AtoB');
      store.pickPoint('right', [15, 7]);
      // The warp mode blocks new picks; nothing is pending and the pairs are unchanged.
      expect(store.pendingPoint.value).toBeNull();
      expect(store.correspondences.value[store.pairKey('left', 'right')]).toHaveLength(4);
    });
  });

  describe('correspondence selection', () => {
    function storeWithOnePair() {
      const store = new CameraRegistrationStore();
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

    it('clears the selection on clearPair, load, and hydrate', () => {
      const { store, id } = storeWithOnePair();
      store.selectCorrespondence(id);
      store.clearPair();
      expect(store.selectedCorrespondenceId.value).toBeNull();

      const loaded = storeWithOnePair();
      loaded.store.selectCorrespondence(loaded.id);
      loaded.store.loadRegistrationText(JSON.stringify({ version: 1, pairs: [] }));
      expect(loaded.store.selectedCorrespondenceId.value).toBeNull();

      const hydrated = storeWithOnePair();
      hydrated.store.selectCorrespondence(hydrated.id);
      hydrated.store.hydrate();
      expect(hydrated.store.selectedCorrespondenceId.value).toBeNull();
    });
  });

  describe('linked navigation', () => {
    it('linkedPoint maps a point from camA to camB and back, via the fitted homography', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store); // left -> right is +5, -3
      store.maybeFitActivePair();
      const fromLeft = store.linkedPoint('left', [1, 1]);
      expect(fromLeft).toMatchObject({ camera: 'right', coord: [6, -2] });
      const fromRight = store.linkedPoint('right', [6, -2]);
      expect(fromRight).toMatchObject({ camera: 'left', coord: [1, 1] });
    });

    it('linkedPoint returns null when the pair has no fitted homography yet', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      expect(store.linkedPoint('left', [1, 1])).toBeNull();
    });

    it('linkedPoint returns null for a camera outside the active pair', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      expect(store.linkedPoint('other', [1, 1])).toBeNull();
    });
  });

  describe('cursor coordinate readout', () => {
    it('records and clears the cursor coordinate', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.setCursorCoord('left', [12, 34]);
      expect(store.cursorCoord.value).toEqual({ camera: 'left', coord: [12, 34] });
      store.clearCursorCoord();
      expect(store.cursorCoord.value).toBeNull();
    });

    it('clears the cursor coordinate when switching pairs', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.setCursorCoord('left', [12, 34]);
      store.setActivePair('left', 'other');
      expect(store.cursorCoord.value).toBeNull();
    });
  });

  describe('clearLast', () => {
    it('drops the pending point without touching completed correspondences', () => {
      const store = new CameraRegistrationStore();
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
      const store = new CameraRegistrationStore();
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
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      expect(() => store.clearLast()).not.toThrow();
      store.clearLast();
      expect(store.pendingPoint.value).toBeNull();
    });

    it('refits when clearing last while alignment mode is active', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.setTransformType(key, 'homography');
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
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('right', [7, 8]);
      expect(store.recenterRequest.value).toMatchObject({ camera: 'right', coord: [7, 8] });
    });

    it('ignores a recenter request for a camera outside the active pair', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('other', [7, 8]);
      expect(store.recenterRequest.value).toBeNull();
    });

    it('assigns a new id to each request so repeated identical requests still change', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('left', [1, 1]);
      const firstId = store.recenterRequest.value?.id;
      store.requestRecenter('left', [1, 1]);
      expect(store.recenterRequest.value?.id).not.toBe(firstId);
    });

    it('clears the recenter request when switching pairs', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.requestRecenter('left', [1, 1]);
      store.setActivePair('left', 'other');
      expect(store.recenterRequest.value).toBeNull();
    });
  });

  describe('sourceIsMixed', () => {
    it('flags only the mixed composite stamp the file merger produces', () => {
      const store = new CameraRegistrationStore();
      expect(store.sourceIsMixed()).toBe(false);
      store.hydrate(undefined, undefined, undefined, { producer: 'kamera', run: 'fl07' });
      expect(store.sourceIsMixed()).toBe(false);
      store.hydrate(undefined, undefined, undefined, {
        mixed: true,
        files: { 'calibration_ir.json': { run: 'fl07' }, 'calibration_uv.json': { run: 'fl09' } },
      });
      expect(store.sourceIsMixed()).toBe(true);
    });
  });

  describe('loaded (file-sourced) homographies', () => {
    // Pure translation by (+5, -3): trivially invertible.
    const translate = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];

    /** Load a matrix-only (point-less) pair from calibration JSON, marking it 'loaded'. */
    function loadMatrixOnlyPair(store: CameraRegistrationStore, left: string, right: string, rightToLeft: number[][]) {
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left, right, points: [], leftToRight: null, rightToLeft,
        }],
      }));
    }

    it('loads a matrix-only pair as B->A with its inverse as A->B and no points', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      loadMatrixOnlyPair(store, 'left', 'right', translate);
      expect(store.correspondences.value[key]).toHaveLength(0);
      expect(store.isLoadedHomography(key)).toBe(true);
      const homog = store.homographies.value[key];
      expect(homog.BtoA).toEqual(translate);
      expect(homog.AtoB[0][2]).toBeCloseTo(-5);
      expect(homog.AtoB[1][2]).toBeCloseTo(3);
    });

    it('keeps a loaded homography through refit checks with too few points', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      loadMatrixOnlyPair(store, 'left', 'right', translate);
      store.maybeFitPair(key);
      expect(store.homographies.value[key]).toBeDefined();
      // Alignment can activate directly off the loaded transform.
      store.setAlignmentMode('AtoB');
      expect(store.alignment.value.mode).toBe('AtoB');
    });

    it('replaces a loaded homography once enough points are picked and fitted', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      loadMatrixOnlyPair(store, 'left', 'right', [[1, 0, 100], [0, 1, 100], [0, 0, 1]]);
      addFourTranslationPairs(store);
      store.maybeFitPair(key);
      expect(store.isLoadedHomography(key)).toBe(false);
      // Fitted from points: right = left + (5, -3), so AtoB translates by (5, -3).
      expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5);
      expect(store.homographies.value[key].AtoB[1][2]).toBeCloseTo(-3);
    });

    it('clearPair removes a loaded homography', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      loadMatrixOnlyPair(store, 'left', 'right', translate);
      store.clearPair();
      expect(store.homographies.value[key]).toBeUndefined();
      expect(store.isLoadedHomography(key)).toBe(false);
    });

    it('clearPair also removes a stale fitted homography immediately', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      addFourTranslationPairs(store);
      store.fitTransform(key);
      store.clearPair();
      expect(store.homographies.value[key]).toBeUndefined();
    });

    it('rejects a singular loaded matrix', () => {
      const store = new CameraRegistrationStore();
      expect(() => loadMatrixOnlyPair(store, 'left', 'right', [[0, 0, 0], [0, 0, 0], [0, 0, 0]]))
        .toThrow(/singular/);
    });

    it('hydrate marks an under-pointed homography as loaded so it survives refit checks', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.hydrate({ [key]: { AtoB: translate, BtoA: translate } }, {}, {});
      expect(store.isLoadedHomography(key)).toBe(true);
      store.maybeFitPair(key);
      expect(store.homographies.value[key]).toBeDefined();
    });
  });

  describe('registration file round trip', () => {
    it('serializes and reloads all pairs', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      addFourTranslationPairs(store);
      store.setTransformType(key, 'translation');
      store.fitTransform(key);
      const json = toSingleFileJson(store);

      const restored = new CameraRegistrationStore();
      restored.setActivePair('left', 'right');
      const result = restored.loadRegistrationText(json);
      expect(result.pairCount).toBe(1);
      expect(result.cameras.sort()).toEqual(['left', 'right']);
      expect(restored.correspondences.value[key]).toHaveLength(4);
      expect(restored.transformTypeForPair(key)).toBe('translation');
      expect(restored.homographies.value[key].AtoB[0][2]).toBeCloseTo(5);
      // Enough points back the homography, so it is treated as fitted.
      expect(restored.isLoadedHomography(key)).toBe(false);
    });

    it('includes pairs that only have a loaded homography (no points)', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('uv', 'ir');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'uv', right: 'ir', points: [], leftToRight: [[1, 0, 5], [0, 1, -3], [0, 0, 1]], rightToLeft: null,
        }],
      }));
      const restored = new CameraRegistrationStore();
      restored.loadRegistrationText(toSingleFileJson(store));
      expect(restored.homographies.value[key]).toBeDefined();
      expect(restored.isLoadedHomography(key)).toBe(true);
    });

    it('reverts alignment to original and keeps the active pair on load', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      store.setAlignmentMode('AtoB');
      const json = toSingleFileJson(store);
      store.loadRegistrationText(json);
      expect(store.alignment.value.mode).toBe('original');
      expect(store.activePair.value).toEqual({ camA: 'left', camB: 'right' });
    });

    it('loads a desktop-persisted calibration.json (no "type" field, one direction only)', () => {
      const store = new CameraRegistrationStore();
      const result = store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'eo',
          right: 'ir',
          points: [[0, 0, 5, -3]],
          leftToRight: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
          rightToLeft: null,
          transformType: 'translation',
        }],
      }));
      expect(result.pairCount).toBe(1);
      const key = store.pairKey('eo', 'ir');
      expect(store.correspondences.value[key]).toHaveLength(1);
      // The missing direction is derived by inversion.
      expect(store.homographies.value[key].BtoA[0][2]).toBeCloseTo(-5);
      expect(store.transformTypeForPair(key)).toBe('translation');
    });

    it('preserves the producer source stamp across load, refinement, and save', () => {
      const store = new CameraRegistrationStore();
      const source = { model: 'colmap-2026-07-01', swathe: 'fl07_C' };
      store.setActivePair('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source,
        pairs: [{
          left: 'left', right: 'right', points: [], leftToRight: null, rightToLeft: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
        }],
      }));
      expect(store.source.value).toStrictEqual(source);
      // In-app refinement replaces the transform but keeps the lineage stamp.
      addFourTranslationPairs(store);
      store.maybeFitPair(store.pairKey('left', 'right'));
      expect(store.source.value).toStrictEqual(source);
      const saved = JSON.parse(toSingleFileJson(store));
      expect(saved.source).toStrictEqual(source);
    });

    it('omits the source key when no stamp was loaded', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      expect('source' in JSON.parse(toSingleFileJson(store))).toBe(false);
    });

    it('clears a previous stamp when loading a file without one', () => {
      const store = new CameraRegistrationStore();
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source: { model: 'old' },
        pairs: [],
      }));
      store.loadRegistrationText(JSON.stringify({ version: 1, pairs: [] }));
      expect(store.source.value).toBeNull();
    });

    it('rejects a non-object source', () => {
      const store = new CameraRegistrationStore();
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 1, source: 'colmap', pairs: [],
      }))).toThrow(/"source" must be an object/);
    });

    it('hydrate restores the source stamp', () => {
      const store = new CameraRegistrationStore();
      store.hydrate({}, {}, {}, { model: 'colmap-x' });
      expect(store.source.value).toStrictEqual({ model: 'colmap-x' });
      store.hydrate({}, {}, {});
      expect(store.source.value).toBeNull();
    });

    it('flags a pair as refined once an in-app fit replaces a stamped matrix', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source: { model: 'colmap-x' },
        pairs: [{
          left: 'left', right: 'right', points: [], leftToRight: null, rightToLeft: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
        }],
      }));
      // Fresh from the producer: loaded, not refined.
      expect(store.isRefinedFromSource(key)).toBe(false);
      addFourTranslationPairs(store);
      store.maybeFitPair(key);
      expect(store.isRefinedFromSource(key)).toBe(true);
    });

    it('does not flag fits as refined when no source stamp is loaded', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      addFourTranslationPairs(store);
      store.fitTransform(key);
      expect(store.isRefinedFromSource(key)).toBe(false);
    });

    it('keeps the refined flag across a save/load round trip', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source: { model: 'colmap-x' },
        pairs: [{
          left: 'left', right: 'right', points: [], leftToRight: null, rightToLeft: [[1, 0, 100], [0, 1, 100], [0, 0, 1]],
        }],
      }));
      addFourTranslationPairs(store);
      store.maybeFitPair(key);

      const restored = new CameraRegistrationStore();
      restored.loadRegistrationText(toSingleFileJson(store));
      // The refit pair saved with its backing points, so it re-marks as
      // fitted (refined) rather than loaded.
      expect(restored.isRefinedFromSource(key)).toBe(true);
    });

    it('rejects non-JSON, missing pairs, malformed pairs, and bad matrices without clobbering state', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      addFourTranslationPairs(store);
      expect(() => store.loadRegistrationText('not json')).toThrow(/valid JSON/);
      expect(() => store.loadRegistrationText('{"type": "other"}')).toThrow(/pairs/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 1, pairs: [{ left: 'a', right: 'a' }],
      }))).toThrow(/distinct/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'a',
          right: 'b',
          points: [],
          leftToRight: [[1, 0], [0, 1]],
          rightToLeft: null,
        }],
      }))).toThrow(/3x3/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{ left: 'a', right: 'b', points: [[1, 2, 3]] }],
      }))).toThrow(/points row/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{ left: 'a', right: 'b', transformType: 'bogus' }],
      }))).toThrow(/transformType/);
      // Failed loads left the existing calibration alone.
      expect(store.correspondences.value[key]).toHaveLength(4);
    });
  });
});
