/// <reference types="vitest" />
import CameraRegistrationStore from './CameraRegistrationStore';

describe('CameraRegistrationStore', () => {
  // Pure translation by (+5, -3): trivially invertible.
  const translate = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];
  // Four correspondence rows consistent with `translate`: right = left + (5, -3).
  const translationPointRows = [
    [0, 0, 5, -3],
    [10, 0, 15, -3],
    [10, 10, 15, 7],
    [0, 10, 5, 7],
  ];

  it('produces a directional pairKey that preserves left/right order', () => {
    const store = new CameraRegistrationStore();
    expect(store.pairKey('rgb', 'ir')).toEqual('rgb::ir');
    expect(store.pairKey('rgb', 'ir')).not.toEqual(store.pairKey('ir', 'rgb'));
  });

  it('hydrates homographies and resets prior calibration state', () => {
    const store = new CameraRegistrationStore();
    store.loadRegistrationText(JSON.stringify({
      version: 1,
      pairs: [{
        left: 'left', right: 'right', points: [[1, 1, 6, -2]], transformType: 'translation',
      }],
    }));
    const saved = { 'a::b': { AtoB: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], BtoA: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } };
    store.hydrate(saved);
    expect(store.homographies.value).toEqual(saved);
    expect(store.correspondences.value).toEqual({});
    expect(store.transformTypes.value).toEqual({});
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
    // Points loaded afterwards pick up ids after the highest restored id.
    store.loadRegistrationText(JSON.stringify({
      version: 1,
      pairs: [{ left: 'rgb', right: 'ir', points: [[9, 9, 10, 10]] }],
    }));
    expect(store.correspondences.value['rgb::ir'][0].id).toBe(3);
  });

  describe('dirty / markSaved', () => {
    it('tracks unsaved changes and resets on markSaved and hydrate', () => {
      const store = new CameraRegistrationStore();
      expect(store.dirty.value).toBe(false);
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'left', right: 'right', points: [], leftToRight: null, rightToLeft: translate,
        }],
      }));
      expect(store.dirty.value).toBe(true);
      store.markSaved();
      expect(store.dirty.value).toBe(false);
      store.hydrate({ 'a::b': { AtoB: translate, BtoA: translate } });
      // Freshly hydrated state is the saved baseline.
      expect(store.dirty.value).toBe(false);
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
      const key = store.pairKey('left', 'right');
      loadMatrixOnlyPair(store, 'left', 'right', translate);
      expect(store.correspondences.value[key]).toHaveLength(0);
      expect(store.isLoadedHomography(key)).toBe(true);
      const homog = store.homographies.value[key];
      expect(homog.BtoA).toEqual(translate);
      expect(homog.AtoB[0][2]).toBeCloseTo(-5);
      expect(homog.AtoB[1][2]).toBeCloseTo(3);
    });

    it('rejects a singular loaded matrix', () => {
      const store = new CameraRegistrationStore();
      expect(() => loadMatrixOnlyPair(store, 'left', 'right', [[0, 0, 0], [0, 0, 0], [0, 0, 0]]))
        .toThrow(/singular/);
    });

    it('hydrate marks an under-pointed homography as loaded', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.hydrate({ [key]: { AtoB: translate, BtoA: translate } }, {}, {});
      expect(store.isLoadedHomography(key)).toBe(true);
    });
  });

  describe('calibration JSON file round trip', () => {
    it('serializes and reloads all pairs', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'left',
          right: 'right',
          points: translationPointRows,
          leftToRight: translate,
          rightToLeft: null,
          transformType: 'translation',
        }],
      }));
      const json = store.toRegistrationJson();

      const restored = new CameraRegistrationStore();
      const result = restored.loadRegistrationText(json);
      expect(result.pairCount).toBe(1);
      expect(result.cameras.sort()).toEqual(['left', 'right']);
      expect(restored.correspondences.value[key]).toHaveLength(4);
      expect(restored.transformTypeForPair(key)).toBe('translation');
      expect(restored.homographies.value[key].AtoB[0][2]).toBeCloseTo(5);
      // The missing direction was derived by inversion and round-tripped.
      expect(restored.homographies.value[key].BtoA[0][2]).toBeCloseTo(-5);
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
      restored.loadRegistrationText(store.toRegistrationJson());
      expect(restored.homographies.value[key]).toBeDefined();
      expect(restored.isLoadedHomography(key)).toBe(true);
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

    it('preserves the producer source stamp across a load/save round trip', () => {
      const store = new CameraRegistrationStore();
      const source = { model: 'colmap-2026-07-01', swathe: 'fl07_C' };
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source,
        pairs: [{
          left: 'left', right: 'right', points: [], leftToRight: null, rightToLeft: translate,
        }],
      }));
      expect(store.source.value).toStrictEqual(source);
      const saved = JSON.parse(store.toRegistrationJson());
      expect(saved.source).toStrictEqual(source);
    });

    it('omits the source key when no stamp was loaded', () => {
      const store = new CameraRegistrationStore();
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'left', right: 'right', points: translationPointRows, leftToRight: translate, rightToLeft: null,
        }],
      }));
      expect('source' in JSON.parse(store.toRegistrationJson())).toBe(false);
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

    it('flags a point-backed homography as refined when a source stamp is loaded', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      // Fresh from the producer (matrix-only): loaded, not refined.
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source: { model: 'colmap-x' },
        pairs: [{
          left: 'left', right: 'right', points: [], leftToRight: null, rightToLeft: translate,
        }],
      }));
      expect(store.isRefinedFromSource(key)).toBe(false);
      // Point-backed under a stamp: the pair has diverged from the producer.
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source: { model: 'colmap-x' },
        pairs: [{
          left: 'left', right: 'right', points: translationPointRows, leftToRight: translate, rightToLeft: null, transformType: 'translation',
        }],
      }));
      expect(store.isRefinedFromSource(key)).toBe(true);
    });

    it('does not flag point-backed homographies as refined when no source stamp is loaded', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'left', right: 'right', points: translationPointRows, leftToRight: translate, rightToLeft: null, transformType: 'translation',
        }],
      }));
      expect(store.isRefinedFromSource(key)).toBe(false);
    });

    it('keeps the refined flag across a save/load round trip', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        source: { model: 'colmap-x' },
        pairs: [{
          left: 'left', right: 'right', points: translationPointRows, leftToRight: translate, rightToLeft: null, transformType: 'translation',
        }],
      }));
      expect(store.isRefinedFromSource(key)).toBe(true);

      const restored = new CameraRegistrationStore();
      restored.loadRegistrationText(store.toRegistrationJson());
      // The refined pair saved with its backing points, so it re-marks as
      // fitted (refined) rather than loaded.
      expect(restored.isRefinedFromSource(key)).toBe(true);
    });

    it('rejects non-JSON, missing pairs, malformed pairs, and bad matrices without clobbering state', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'left', right: 'right', points: translationPointRows, leftToRight: translate, rightToLeft: null,
        }],
      }));
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
