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
    const { AtoB, BtoA } = store.fitHomography(key);
    expect(AtoB[0][2]).toBeCloseTo(5, 5);
    expect(AtoB[1][2]).toBeCloseTo(-3, 5);
    expect(BtoA[0][2]).toBeCloseTo(-5, 5);
    expect(store.homographies.value[key]).toBeDefined();
  });

  it('throws when fitting with fewer than 4 pairs', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    expect(() => store.fitHomography(key)).toThrow();
  });

  function addFourTranslationPairs(store: CameraCalibrationStore) {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    pts.forEach((p) => {
      store.addPoint('left', p);
      store.addPoint('right', [p[0] + 5, p[1] - 3]);
    });
  }

  it('fits when enabling the overlay with >= 4 pairs', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setOverlayEnabled(true);
    expect(store.overlay.value.enabled).toBe(true);
    expect(store.homographies.value[key]).toBeDefined();
    expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5, 5);
  });

  it('does not enable the overlay with fewer than 4 pairs', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    store.setOverlayEnabled(true);
    expect(store.overlay.value.enabled).toBe(false);
    expect(store.homographies.value).toEqual({});
  });

  it('refits when correspondences change while the overlay is enabled', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setOverlayEnabled(true);
    const before = store.homographies.value[key].AtoB[0][2];
    store.addPoint('left', [20, 20]);
    store.addPoint('right', [30, 14]);
    expect(store.homographies.value[key].AtoB[0][2]).not.toBeCloseTo(before, 5);
  });

  it('disables the overlay when correspondences drop below 4', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setOverlayEnabled(true);
    const { id } = store.correspondences.value[key][0];
    store.removeCorrespondence(id);
    store.removeCorrespondence(store.correspondences.value[key][0].id);
    store.removeCorrespondence(store.correspondences.value[key][0].id);
    store.removeCorrespondence(store.correspondences.value[key][0].id);
    expect(store.correspondences.value[key]).toHaveLength(0);
    expect(store.overlay.value.enabled).toBe(false);
    expect(store.homographies.value[key]).toBeUndefined();
  });

  it('maybeFitActivePair fits without enabling the overlay', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.maybeFitActivePair();
    expect(store.overlay.value.enabled).toBe(false);
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
  });

  it('exports points as four columns "leftX leftY rightX rightY"', () => {
    const store = new CameraCalibrationStore();
    store.setActivePair('rgb', 'ir');
    const key = store.pairKey('rgb', 'ir');
    store.addPoint('rgb', [10, 20]); // left
    store.addPoint('ir', [30, 40]); // right
    store.addPoint('ir', [31, 41]); // left/right order independent of click order
    store.addPoint('rgb', [11, 21]);
    expect(store.toPointsText(key)).toBe('10 20 30 40\n11 21 31 41');
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
});
