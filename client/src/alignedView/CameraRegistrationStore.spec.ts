import CameraRegistrationStore, {
  CorrespondencePoint, FrameResolver,
} from './CameraRegistrationStore';
import { buildPerCameraRegistrationFiles } from './cameraRegistrationFiles';

/**
 * Serialize a store's state through the production per-camera serializer
 * (buildPerCameraRegistrationFiles) -- the only registration file format --
 * and return the single resulting file body as JSON text for round trips.
 */
function toSingleFileJson(store: CameraRegistrationStore): string {
  const files = buildPerCameraRegistrationFiles({
    homographies: store.homographies.value,
    observations: store.observations.value,
    transformTypes: store.transformTypes.value,
    source: store.source.value,
  }, null);
  expect(files).toHaveLength(1);
  return JSON.stringify(files[0].body);
}

/** All of a pair's points pooled across observations (any enabled state). */
function pointsFor(store: CameraRegistrationStore, key: string): CorrespondencePoint[] {
  return store.observationsForPair(key).flatMap((obs) => obs.points);
}

/**
 * A resolver over fixed per-camera image lists, pinned to a settable
 * current frame -- the shape the viewer publishes in production.
 */
function makeResolver(
  images: Record<string, string[]>,
  current: { frame: number },
): FrameResolver {
  return {
    currentImageName: (camera: string) => images[camera]?.[current.frame] ?? null,
    frameForImage: (camera: string, imageName: string) => {
      const index = (images[camera] ?? []).indexOf(imageName);
      return index >= 0 ? index : null;
    },
  };
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
    expect(pointsFor(store, key)).toHaveLength(0);
    store.addPoint('right', [30, 40]); // completes (red)
    expect(store.pendingPoint.value).toBeNull();
    expect(pointsFor(store, key)).toHaveLength(1);
    expect(pointsFor(store, key)[0]).toMatchObject({ a: [10, 20], b: [30, 40] });
  });

  it('maps points to a/b by camera regardless of click order', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('right', [30, 40]); // click right first
    store.addPoint('left', [10, 20]);
    expect(pointsFor(store, key)[0]).toMatchObject({ a: [10, 20], b: [30, 40] });
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
    const { id } = pointsFor(store, key)[0];
    store.removeCorrespondence(id);
    expect(pointsFor(store, key)).toHaveLength(0);
  });

  it('moves one side of a correspondence via updateCorrespondencePoint', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    const { id } = pointsFor(store, key)[0];
    store.updateCorrespondencePoint(id, 'left', [5, 6]);
    expect(pointsFor(store, key)[0].a).toEqual([5, 6]);
    expect(pointsFor(store, key)[0].b).toEqual([2, 2]);
    store.updateCorrespondencePoint(id, 'right', [7, 8]);
    expect(pointsFor(store, key)[0].b).toEqual([7, 8]);
  });

  it('ignores updateCorrespondencePoint for unknown ids or cameras outside the pair', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    store.addPoint('left', [1, 1]);
    store.addPoint('right', [2, 2]);
    const { id } = pointsFor(store, key)[0];
    store.updateCorrespondencePoint(id + 99, 'left', [5, 6]);
    store.updateCorrespondencePoint(id, 'other', [5, 6]);
    expect(pointsFor(store, key)[0]).toMatchObject({ a: [1, 1], b: [2, 2] });
  });

  it('refits the pair homography when a point is drag-refined while alignment is active', () => {
    const store = new CameraRegistrationStore();
    store.setActivePair('left', 'right');
    const key = store.pairKey('left', 'right');
    addFourTranslationPairs(store);
    store.setAlignmentMode('AtoB');
    const before = store.homographies.value[key].AtoB[0][2];
    const { id } = pointsFor(store, key)[0];
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
    const { id } = pointsFor(store, key)[0];
    store.removeCorrespondence(id);
    store.removeCorrespondence(pointsFor(store, key)[0].id);
    store.removeCorrespondence(pointsFor(store, key)[0].id);
    store.removeCorrespondence(pointsFor(store, key)[0].id);
    expect(pointsFor(store, key)).toHaveLength(0);
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
    expect(store.observations.value).toEqual({});
    expect(store.transformTypes.value).toEqual({});
    expect(store.alignment.value).toEqual({ mode: 'original', opacity: 0.5 });
  });

  it('hydrates transform types alongside homographies', () => {
    const store = new CameraRegistrationStore();
    store.hydrate({}, {}, { 'a::b': 'rigid' });
    expect(store.transformTypeForPair('a::b')).toBe('rigid');
    expect(store.transformTypeForPair('unset::pair')).toBe('similarity');
  });

  it('hydrates observations and resumes id allocation', () => {
    const store = new CameraRegistrationStore();
    const observations = {
      'rgb::ir': [{
        imageA: 'rgb_0001.jpg',
        imageB: 'ir_0001.tif',
        frame: 1,
        enabled: true,
        source: 'manual',
        points: [
          { id: 1, a: [1, 2] as [number, number], b: [3, 4] as [number, number] },
          { id: 2, a: [5, 6] as [number, number], b: [7, 8] as [number, number] },
        ],
      }],
    };
    store.hydrate({}, observations);
    expect(store.observations.value).toEqual(observations);
    // New points pick up after the highest restored id.
    store.setActivePair('rgb', 'ir');
    store.addPoint('rgb', [9, 9]);
    store.addPoint('ir', [10, 10]);
    expect(pointsFor(store, 'rgb::ir')[2].id).toBe(3);
  });

  describe('observation identity', () => {
    it('stamps new points with the current image pair and manual provenance', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      const [obs] = store.observationsForPair(key);
      // Without a resolver, frames identify via frame:// pseudo-names.
      expect(obs).toMatchObject({
        imageA: 'frame://0',
        imageB: 'frame://0',
        frame: 0,
        enabled: true,
        source: 'manual',
      });
    });

    it('groups points picked on different frames into separate observations', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      store.currentFrame.value = 100;
      store.addPoint('left', [3, 3]);
      store.addPoint('right', [4, 4]);
      const observations = store.observationsForPair(key);
      expect(observations).toHaveLength(2);
      expect(observations.map((obs) => obs.frame)).toEqual([0, 100]);
      expect(observations.every((obs) => obs.points.length === 1)).toBe(true);
    });

    it('stamps real image names and resolves frames through the resolver', () => {
      const store = new CameraRegistrationStore();
      const current = { frame: 2 };
      store.setFrameResolver(makeResolver({
        left: ['l0.jpg', 'l1.jpg', 'l2.jpg'],
        right: ['r0.tif', 'r1.tif', 'r2.tif'],
      }, current));
      store.currentFrame.value = 2;
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      const [obs] = store.observationsForPair(key);
      expect(obs).toMatchObject({
        imageA: 'l2.jpg', imageB: 'r2.tif', frame: 2, source: 'manual',
      });
    });

    it('re-resolves frames from image names when a resolver is published', () => {
      const store = new CameraRegistrationStore();
      store.hydrate({}, {
        'left::right': [{
          imageA: 'l1.jpg',
          imageB: 'r1.tif',
          // A stale index from another deployment must not survive: the
          // image NAME is the identity.
          frame: 999,
          enabled: true,
          source: 'manual',
          points: [{ id: 1, a: [0, 0], b: [0, 0] }],
        }, {
          imageA: 'other_deployment.jpg',
          imageB: 'other_deployment.tif',
          frame: 3,
          enabled: true,
          source: 'manual',
          points: [{ id: 2, a: [0, 0], b: [0, 0] }],
        }],
      });
      const current = { frame: 0 };
      store.setFrameResolver(makeResolver({
        left: ['l0.jpg', 'l1.jpg'],
        right: ['r0.tif', 'r1.tif'],
      }, current));
      const observations = store.observationsForPair('left::right');
      expect(observations[0].frame).toBe(1);
      // Not in this dataset: unresolvable here, not a guess.
      expect(observations[1].frame).toBeNull();
      // Frame resolution is derived state, not an edit.
      expect(store.dirty.value).toBe(false);
    });

    it('scopes correspondencesForFrame to one frame and carries identity', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      store.currentFrame.value = 7;
      store.addPoint('left', [3, 3]);
      store.addPoint('right', [4, 4]);
      expect(store.correspondencesForFrame(key, 0)).toHaveLength(1);
      const [c] = store.correspondencesForFrame(key, 7);
      expect(c).toMatchObject({
        a: [3, 3], b: [4, 4], frame: 7, source: 'manual',
      });
      expect(store.correspondencesForFrame(key, 5)).toHaveLength(0);
    });

    it('resolves correspondencesForCameraFrame per side in each camera frame space', () => {
      const store = new CameraRegistrationStore();
      const current = { frame: 0 };
      // right's media list is offset by one against left's.
      store.setFrameResolver(makeResolver({
        left: ['l0.jpg', 'l1.jpg', 'l2.jpg'],
        right: ['pad.tif', 'r0.tif', 'r1.tif'],
      }, current));
      store.hydrate({}, {
        'left::right': [{
          imageA: 'l1.jpg',
          imageB: 'r1.tif',
          frame: 1,
          enabled: true,
          source: 'manual',
          points: [{ id: 1, a: [0, 0], b: [0, 0] }],
        }],
      });
      const key = 'left::right';
      // The A side matches left's local frame 1...
      expect(store.correspondencesForCameraFrame(key, 'left', 1)).toHaveLength(1);
      expect(store.correspondencesForCameraFrame(key, 'left', 2)).toHaveLength(0);
      // ...while the B side matches right's own local index for r1.tif (2).
      expect(store.correspondencesForCameraFrame(key, 'right', 2)).toHaveLength(1);
      expect(store.correspondencesForCameraFrame(key, 'right', 1)).toHaveLength(0);
    });

    it('lists framesForPair sorted by frame with unresolved rows last', () => {
      const store = new CameraRegistrationStore();
      store.hydrate({}, {
        'left::right': [
          {
            imageA: 'zz-unresolved.jpg', imageB: 'x.tif', frame: null, enabled: true, source: 'manual', points: [],
          },
          {
            imageA: 'b.jpg', imageB: 'b.tif', frame: 10, enabled: false, source: 'minima_loftr', points: [{ id: 1, a: [0, 0], b: [0, 0] }],
          },
          {
            imageA: 'a.jpg', imageB: 'a.tif', frame: 2, enabled: true, source: 'manual', points: [{ id: 2, a: [0, 0], b: [0, 0] }],
          },
        ],
      });
      const rows = store.framesForPair('left::right');
      expect(rows.map((row) => row.frame)).toEqual([2, 10, null]);
      expect(rows[1]).toMatchObject({ enabled: false, source: 'minima_loftr', count: 1 });
    });
  });

  describe('enabled observations and pooled fitting', () => {
    /** Two frames of translation-consistent points, one frame corrupted. */
    function storeWithGoodAndBadFrames() {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      addFourTranslationPairs(store); // frame 0: +5, -3
      store.currentFrame.value = 10; // frame 10: consistent with frame 0
      ([[20, 20], [30, 20], [30, 30], [20, 30]] as [number, number][]).forEach((p) => {
        store.addPoint('left', p);
        store.addPoint('right', [p[0] + 5, p[1] - 3]);
      });
      store.currentFrame.value = 20; // frame 20: corrupted (offset +50, +50)
      ([[40, 40], [50, 40], [50, 50], [40, 50]] as [number, number][]).forEach((p) => {
        store.addPoint('left', p);
        store.addPoint('right', [p[0] + 50, p[1] + 50]);
      });
      return { store, key };
    }

    it('pools points across every enabled observation for the fit', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      // Two frames with two points each: neither alone can fit a homography,
      // pooled they can.
      store.addPoint('left', [0, 0]);
      store.addPoint('right', [5, -3]);
      store.addPoint('left', [10, 0]);
      store.addPoint('right', [15, -3]);
      store.currentFrame.value = 5;
      store.addPoint('left', [10, 10]);
      store.addPoint('right', [15, 7]);
      store.addPoint('left', [0, 10]);
      store.addPoint('right', [5, 7]);
      expect(store.observationsForPair(key)).toHaveLength(2);
      const { AtoB } = store.fitTransform(key);
      expect(AtoB[0][2]).toBeCloseTo(5, 5);
      expect(AtoB[1][2]).toBeCloseTo(-3, 5);
    });

    it('excludes disabled observations from the fit without deleting points', () => {
      const { store, key } = storeWithGoodAndBadFrames();
      store.setFrameEnabled(key, 20, false);
      const { AtoB } = store.homographies.value[key];
      // With the corrupted frame excluded, the consensus translation returns.
      expect(AtoB[0][2]).toBeCloseTo(5, 3);
      expect(AtoB[1][2]).toBeCloseTo(-3, 3);
      // The points survive, disabled.
      const disabled = store.observationsForPair(key).find((obs) => obs.frame === 20);
      expect(disabled?.enabled).toBe(false);
      expect(disabled?.points).toHaveLength(4);
      // Re-enabling refits with them again.
      store.setFrameEnabled(key, 20, true);
      expect(store.homographies.value[key].AtoB[0][2]).not.toBeCloseTo(5, 3);
    });

    it('reports per-observation agreement with the pooled fit via pairFitStats', () => {
      const { store, key } = storeWithGoodAndBadFrames();
      store.setFrameEnabled(key, 20, false);
      const stats = store.pairFitStats(key);
      expect(stats.frameCount).toBe(2);
      expect(stats.pointCount).toBe(8);
      expect(stats.rmsPx).toBeLessThan(1e-6);
      const byFrame = new Map(stats.perObservation.map((obs) => [obs.frame, obs]));
      // The two consistent frames agree with the consensus...
      expect(byFrame.get(0)?.rmsPx).toBeLessThan(1e-6);
      expect(byFrame.get(10)?.rmsPx).toBeLessThan(1e-6);
      // ...and the corrupted frame's disagreement is measured, visibly large,
      // even while excluded.
      expect(byFrame.get(20)?.enabled).toBe(false);
      expect(byFrame.get(20)?.rmsPx).toBeGreaterThan(10);
    });

    it('setObservationEnabled targets a single observation by image pair', () => {
      const { store, key } = storeWithGoodAndBadFrames();
      const bad = store.observationsForPair(key).find((obs) => obs.frame === 20);
      expect(bad).toBeDefined();
      store.setObservationEnabled(key, bad!.imageA, bad!.imageB, false);
      expect(store.observationsForPair(key).find((obs) => obs.frame === 20)?.enabled).toBe(false);
      expect(store.observationsForPair(key).filter((obs) => obs.enabled)).toHaveLength(2);
    });

    it('clearFrame removes one frame\'s observations and refits', () => {
      const { store, key } = storeWithGoodAndBadFrames();
      store.clearFrame(key, 20);
      expect(store.observationsForPair(key)).toHaveLength(2);
      expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5, 3);
    });

    it('removeObservation restricted by source leaves other producers alone', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      store.applyRegistrationResult('left', 'right', [{
        source: 'minima_loftr',
        points: [[0, 0, 5, -3], [10, 0, 15, -3], [10, 10, 15, 7], [0, 10, 5, 7]],
      }]);
      expect(store.observationsForPair(key)).toHaveLength(2);
      const matcher = store.observationsForPair(key).find((obs) => obs.source === 'minima_loftr');
      store.removeObservation(key, matcher!.imageA, matcher!.imageB, 'minima_loftr');
      const remaining = store.observationsForPair(key);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].source).toBe('manual');
    });

    it('maybeFitPair counts only enabled points toward the minimum', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      addFourTranslationPairs(store);
      store.maybeFitPair(key);
      expect(store.homographies.value[key]).toBeDefined();
      store.setFrameEnabled(key, 0, false);
      // All points disabled: below the minimum, the fit clears.
      expect(store.homographies.value[key]).toBeUndefined();
    });
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
      expect(pointsFor(store, store.pairKey('left', 'right'))).toHaveLength(4);
    });
  });

  describe('correspondence selection', () => {
    function storeWithOnePair() {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      const key = store.pairKey('left', 'right');
      const { id } = pointsFor(store, key)[0];
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
      expect(pointsFor(store, key)).toHaveLength(0);
      expect(store.selectedCorrespondenceId.value).toBeNull();
      // No selection: a further call is a no-op.
      store.removeSelectedCorrespondence();
      expect(pointsFor(store, key)).toHaveLength(0);
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
      loaded.store.loadRegistrationText(JSON.stringify({ version: 2, pairs: [] }));
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
      expect(pointsFor(store, key)).toHaveLength(1);
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
      expect(pointsFor(store, key)).toHaveLength(1);
      expect(pointsFor(store, key)[0]).toMatchObject({ a: [1, 1], b: [2, 2] });
    });

    it('acts on the current frame only', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.addPoint('left', [1, 1]);
      store.addPoint('right', [2, 2]);
      store.currentFrame.value = 5;
      store.addPoint('left', [3, 3]);
      store.addPoint('right', [4, 4]);
      // Back on frame 0: undo removes frame 0's point, not frame 5's newer one.
      store.currentFrame.value = 0;
      store.clearLast();
      expect(store.correspondencesForFrame(key, 0)).toHaveLength(0);
      expect(store.correspondencesForFrame(key, 5)).toHaveLength(1);
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
      expect(pointsFor(store, key)).toHaveLength(3);
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

    /** Load a matrix-only (observation-less) pair from a v2 file, marking it 'loaded'. */
    function loadMatrixOnlyPair(store: CameraRegistrationStore, left: string, right: string, rightToLeft: number[][]) {
      store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{
          left, right, observations: [], leftToRight: null, rightToLeft,
        }],
      }));
    }

    it('loads a matrix-only pair as B->A with its inverse as A->B and no points', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      loadMatrixOnlyPair(store, 'left', 'right', translate);
      expect(pointsFor(store, key)).toHaveLength(0);
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

    it('treats a homography backed only by DISABLED observations as loaded', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.hydrate({ [key]: { AtoB: translate, BtoA: translate } }, {
        [key]: [{
          imageA: 'a.jpg',
          imageB: 'b.tif',
          frame: 0,
          enabled: false,
          source: 'manual',
          points: [
            { id: 1, a: [0, 0], b: [5, -3] },
            { id: 2, a: [10, 0], b: [15, -3] },
            { id: 3, a: [10, 10], b: [15, 7] },
            { id: 4, a: [0, 10], b: [5, 7] },
          ],
        }],
      });
      // The disabled points can't back a fit, so the matrix must be file-loaded.
      expect(store.isLoadedHomography(key)).toBe(true);
      store.maybeFitPair(key);
      expect(store.homographies.value[key]).toBeDefined();
    });

    it('pickingDefaultFor opens loaded pairs in review posture, others authoring', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      // No transform at all: authoring.
      expect(store.pickingDefaultFor(key)).toBe(true);
      expect(store.pickingDefaultFor(null)).toBe(true);
      // File-loaded transform: review.
      loadMatrixOnlyPair(store, 'left', 'right', translate);
      expect(store.pickingDefaultFor(key)).toBe(false);
      // Point-backed fit: authoring again.
      addFourTranslationPairs(store);
      store.maybeFitPair(key);
      expect(store.pickingDefaultFor(key)).toBe(true);
    });
  });

  describe('hasSavedRegistration', () => {
    const translate = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];

    it('is false for a fresh store and empty hydrate', () => {
      const store = new CameraRegistrationStore();
      expect(store.hasSavedRegistration()).toBe(false);
      store.hydrate({}, {}, {});
      expect(store.hasSavedRegistration()).toBe(false);
    });

    it('ignores unsaved in-progress work until markSaved', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      addFourTranslationPairs(store);
      expect(store.hasSavedRegistration()).toBe(false);
      store.markSaved();
      expect(store.hasSavedRegistration()).toBe(true);
    });

    it('is true after hydrating a saved homography', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.hydrate({ [key]: { AtoB: translate, BtoA: translate } }, {}, {});
      expect(store.hasSavedRegistration()).toBe(true);
    });

    it('treats leftover empty observation lists as no registration', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('left', 'right');
      store.hydrate({}, { [key]: [] }, {});
      expect(store.hasSavedRegistration()).toBe(false);
    });
  });

  describe('applyRegistrationResult', () => {
    // A pure translation by (5, -3), as [ax, ay, bx, by] matcher-style rows.
    const inliers: [number, number, number, number][] = [
      [0, 0, 5, -3], [10, 0, 15, -3], [10, 10, 15, 7], [0, 10, 5, 7],
      [5, 5, 10, 2],
    ];

    it('injects observations with matcher provenance and fits a homography', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('rgb', 'ir');
      const key = store.pairKey('rgb', 'ir');
      expect(store.pickingEnabled.value).toBe(false);
      store.applyRegistrationResult('rgb', 'ir', [{ source: 'minima_loftr', points: inliers }]);
      // Picking turns on so the injected points are visible for review.
      expect(store.pickingEnabled.value).toBe(true);
      expect(pointsFor(store, key)).toHaveLength(5);
      const [obs] = store.observationsForPair(key);
      // Provenance rides on the observation, not the rig-global source stamp.
      expect(obs.source).toBe('minima_loftr');
      expect(obs.enabled).toBe(true);
      expect(store.transformTypes.value[key]).toBe('homography');
      const { AtoB } = store.homographies.value[key];
      expect(AtoB[0][2]).toBeCloseTo(5, 5);
      expect(AtoB[1][2]).toBeCloseTo(-3, 5);
      expect(store.fitError.value).toBeNull();
      expect(store.dirty.value).toBe(true);
    });

    it('carries explicit image identities, stats, and enabled state', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('rgb', 'ir');
      const key = store.pairKey('rgb', 'ir');
      store.applyRegistrationResult('rgb', 'ir', [{
        imageA: 'rgb_0412.jpg',
        imageB: 'ir_0412.tif',
        source: 'minima_loftr',
        stats: { numMatches: 1840, numInliers: 24 },
        points: inliers,
      }, {
        imageA: 'rgb_2600.jpg',
        imageB: 'ir_2600.tif',
        enabled: false,
        source: 'minima_loftr',
        stats: { skipped: 'low_texture' },
        points: [],
      }]);
      const observations = store.observationsForPair(key);
      expect(observations).toHaveLength(2);
      expect(observations[0]).toMatchObject({
        imageA: 'rgb_0412.jpg',
        stats: { numMatches: 1840, numInliers: 24 },
      });
      // The rejected candidate is kept, disabled, with its reason.
      expect(observations[1]).toMatchObject({
        enabled: false, stats: { skipped: 'low_texture' },
      });
      // Only the enabled observation feeds the fit.
      expect(store.homographies.value[key].AtoB[0][2]).toBeCloseTo(5, 5);
    });

    it('merges at observation granularity: replaces its own prior result, keeps manual work', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('rgb', 'ir');
      const key = store.pairKey('rgb', 'ir');
      // Hand-picked observation on the current (frame://0) image pair.
      store.addPoint('rgb', [1, 1]);
      store.addPoint('ir', [2, 2]);
      // First matcher run on a specific image pair.
      store.applyRegistrationResult('rgb', 'ir', [{
        imageA: 'rgb_0412.jpg', imageB: 'ir_0412.tif', source: 'minima_loftr', points: inliers,
      }]);
      expect(store.observationsForPair(key)).toHaveLength(2);
      // Re-running the matcher on the same image pair REPLACES its result...
      store.applyRegistrationResult('rgb', 'ir', [{
        imageA: 'rgb_0412.jpg',
        imageB: 'ir_0412.tif',
        source: 'minima_loftr',
        points: inliers.slice(0, 4),
      }]);
      const observations = store.observationsForPair(key);
      expect(observations).toHaveLength(2);
      const matcher = observations.find((obs) => obs.source === 'minima_loftr');
      expect(matcher?.points).toHaveLength(4);
      // ...while the manual observation survives untouched.
      const manual = observations.find((obs) => obs.source === 'manual');
      expect(manual?.points).toHaveLength(1);
    });

    it('leaves the rig-global source stamp untouched', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('rgb', 'ir');
      // A producer stamp from a loaded registration: rig-global, so a
      // single pair's auto-register must not restamp it (that would rewrite
      // every camera's file on the next save, not just this pair's).
      const producer = { model: 'N56RF', flight: 'dataset_1' };
      store.source.value = { ...producer };
      store.applyRegistrationResult('rgb', 'ir', [{ source: 'minima_loftr', points: inliers }]);
      expect(store.source.value).toEqual(producer);
      // And with no loaded registration, none appears.
      const fresh = new CameraRegistrationStore();
      fresh.setActivePair('rgb', 'ir');
      fresh.applyRegistrationResult('rgb', 'ir', [{ source: 'minima_loftr', points: inliers }]);
      expect(fresh.source.value).toBeNull();
    });

    it('clears authoring state and keeps injected points editable', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('rgb', 'ir');
      const key = store.pairKey('rgb', 'ir');
      store.addPoint('rgb', [1, 1]);
      store.addPoint('ir', [2, 2]);
      store.selectCorrespondence(pointsFor(store, key)[0].id);
      store.addPoint('rgb', [3, 3]); // pending
      store.applyRegistrationResult('rgb', 'ir', [{ source: 'minima_loftr', points: inliers }]);
      expect(store.pendingPoint.value).toBeNull();
      expect(store.selectedCorrespondenceId.value).toBeNull();
      // Injected points are ordinary correspondences: editable like picked ones.
      const matcher = store.observationsForPair(key).find((obs) => obs.source === 'minima_loftr');
      const first = matcher!.points[0];
      store.updateCorrespondencePoint(first.id, 'rgb', [100, 100]);
      const updated = store.observationsForPair(key).find((obs) => obs.source === 'minima_loftr');
      expect(updated!.points[0].a).toEqual([100, 100]);
    });

    it('surfaces a fitError instead of throwing on degenerate inliers', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('rgb', 'ir');
      const key = store.pairKey('rgb', 'ir');
      // All points collinear: enough rows for a homography but unsolvable.
      const degenerate: [number, number, number, number][] = [
        [0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3],
      ];
      store.applyRegistrationResult('rgb', 'ir', [{ source: 'minima_loftr', points: degenerate }]);
      expect(pointsFor(store, key)).toHaveLength(4);
      expect(store.fitError.value).not.toBeNull();
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
      expect(pointsFor(restored, key)).toHaveLength(4);
      expect(restored.transformTypeForPair(key)).toBe('translation');
      expect(restored.homographies.value[key].AtoB[0][2]).toBeCloseTo(5);
      // Enough points back the homography, so it is treated as fitted.
      expect(restored.isLoadedHomography(key)).toBe(false);
    });

    it('round-trips observation identity, enabled state, provenance, and stats', () => {
      const store = new CameraRegistrationStore();
      store.setActivePair('left', 'right');
      const key = store.pairKey('left', 'right');
      store.applyRegistrationResult('left', 'right', [{
        imageA: 'l_0412.jpg',
        imageB: 'r_0412.tif',
        source: 'minima_loftr',
        stats: { numInliers: 4, rmsPx: 1.2 },
        points: [[0, 0, 5, -3], [10, 0, 15, -3], [10, 10, 15, 7], [0, 10, 5, 7]],
      }, {
        imageA: 'l_2600.jpg',
        imageB: 'r_2600.tif',
        enabled: false,
        source: 'minima_loftr',
        stats: { skipped: 'low_texture', textureScore: 3.1 },
        points: [],
      }]);
      const body = JSON.parse(toSingleFileJson(store));
      expect(body.version).toBe(2);
      // Points live ONLY in observations: no flattened duplicate.
      expect(body.pairs[0].points).toBeUndefined();
      expect(body.pairs[0].observations).toHaveLength(2);
      expect(body.pairs[0].observations[0]).toMatchObject({
        imageLeft: 'l_0412.jpg',
        imageRight: 'r_0412.tif',
        enabled: true,
        source: 'minima_loftr',
        stats: { numInliers: 4, rmsPx: 1.2 },
      });
      expect(body.pairs[0].observations[0].points).toHaveLength(4);
      expect(body.pairs[0].observations[1]).toMatchObject({
        enabled: false,
        stats: { skipped: 'low_texture', textureScore: 3.1 },
        points: [],
      });

      const restored = new CameraRegistrationStore();
      restored.loadRegistrationText(JSON.stringify(body));
      const observations = restored.observationsForPair(key);
      expect(observations).toHaveLength(2);
      expect(observations[0]).toMatchObject({
        imageA: 'l_0412.jpg', imageB: 'r_0412.tif', source: 'minima_loftr', enabled: true,
      });
      expect(observations[1]).toMatchObject({
        enabled: false, stats: { skipped: 'low_texture', textureScore: 3.1 },
      });
    });

    it('accepts a producer observation without a frame (names are the identity)', () => {
      const store = new CameraRegistrationStore();
      const result = store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{
          left: 'eo',
          right: 'ir',
          observations: [{
            imageLeft: 'eo_0001.jpg',
            imageRight: 'ir_0001.tif',
            source: 'kamera-solver',
            points: [[0, 0, 5, -3]],
          }],
          leftToRight: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
          rightToLeft: null,
          transformType: 'translation',
        }],
      }));
      expect(result.pairCount).toBe(1);
      const key = store.pairKey('eo', 'ir');
      const [obs] = store.observationsForPair(key);
      // No resolver in this context: unresolved here, not a guess.
      expect(obs.frame).toBeNull();
      expect(obs.source).toBe('kamera-solver');
      // The missing direction is derived by inversion.
      expect(store.homographies.value[key].BtoA[0][2]).toBeCloseTo(-5);
      expect(store.transformTypeForPair(key)).toBe('translation');
    });

    it('resolves frames from image names on load when a resolver is present', () => {
      const store = new CameraRegistrationStore();
      const current = { frame: 0 };
      store.setFrameResolver(makeResolver({
        eo: ['eo_0000.jpg', 'eo_0001.jpg'],
        ir: ['ir_0000.tif', 'ir_0001.tif'],
      }, current));
      store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{
          left: 'eo',
          right: 'ir',
          observations: [{
            // The file's own (stale) frame is advisory; the name decides.
            frame: 999,
            imageLeft: 'eo_0001.jpg',
            imageRight: 'ir_0001.tif',
            points: [[0, 0, 5, -3]],
          }],
        }],
      }));
      expect(store.observationsForPair('eo::ir')[0].frame).toBe(1);
    });

    it('REJECTS any version other than 2 with a clear message', () => {
      const store = new CameraRegistrationStore();
      // A v1 file would otherwise load as a matrix-only pair with its points
      // silently dropped -- indistinguishable from a real producer file.
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 1,
        pairs: [{
          left: 'a', right: 'b', points: [[0, 0, 5, -3]], leftToRight: null, rightToLeft: null,
        }],
      }))).toThrow(/version/i);
      expect(() => store.loadRegistrationText(JSON.stringify({ pairs: [] })))
        .toThrow(/version/i);
      expect(() => store.loadRegistrationText(JSON.stringify({ version: 3, pairs: [] })))
        .toThrow(/version/i);
    });

    it('includes pairs that only have a loaded homography (no points)', () => {
      const store = new CameraRegistrationStore();
      const key = store.pairKey('uv', 'ir');
      store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{
          left: 'uv', right: 'ir', observations: [], leftToRight: [[1, 0, 5], [0, 1, -3], [0, 0, 1]], rightToLeft: null,
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

    it('preserves the producer source stamp across load, refinement, and save', () => {
      const store = new CameraRegistrationStore();
      const source = { model: 'colmap-2026-07-01', swathe: 'fl07_C' };
      store.setActivePair('left', 'right');
      store.loadRegistrationText(JSON.stringify({
        version: 2,
        source,
        pairs: [{
          left: 'left', right: 'right', observations: [], leftToRight: null, rightToLeft: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
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
        version: 2,
        source: { model: 'old' },
        pairs: [],
      }));
      store.loadRegistrationText(JSON.stringify({ version: 2, pairs: [] }));
      expect(store.source.value).toBeNull();
    });

    it('rejects a non-object source', () => {
      const store = new CameraRegistrationStore();
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 2, source: 'colmap', pairs: [],
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
        version: 2,
        source: { model: 'colmap-x' },
        pairs: [{
          left: 'left', right: 'right', observations: [], leftToRight: null, rightToLeft: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
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
        version: 2,
        source: { model: 'colmap-x' },
        pairs: [{
          left: 'left', right: 'right', observations: [], leftToRight: null, rightToLeft: [[1, 0, 100], [0, 1, 100], [0, 0, 1]],
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
        version: 2, pairs: [{ left: 'a', right: 'a' }],
      }))).toThrow(/distinct/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{
          left: 'a',
          right: 'b',
          observations: [],
          leftToRight: [[1, 0], [0, 1]],
          rightToLeft: null,
        }],
      }))).toThrow(/3x3/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{
          left: 'a',
          right: 'b',
          observations: [{ imageLeft: 'x.jpg', imageRight: 'y.tif', points: [[1, 2, 3]] }],
        }],
      }))).toThrow(/points row/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{
          left: 'a',
          right: 'b',
          observations: [{ imageRight: 'y.tif', points: [] }],
        }],
      }))).toThrow(/imageLeft/);
      expect(() => store.loadRegistrationText(JSON.stringify({
        version: 2,
        pairs: [{ left: 'a', right: 'b', transformType: 'bogus' }],
      }))).toThrow(/transformType/);
      // Failed loads left the existing calibration alone.
      expect(pointsFor(store, key)).toHaveLength(4);
    });
  });
});
