/// <reference types="vitest" />
import { applyHomography, solveHomography, Matrix3 } from './homography';
import {
  TransformType,
  minPointsForTransform,
  estimateTranslation,
  estimateRigid,
  estimateSimilarity,
  estimateAffine,
  estimateTransform,
  Point,
} from './transform';

function expectMatrixClose(actual: Matrix3, expected: Matrix3, precision = 4) {
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      expect(actual[i][j]).toBeCloseTo(expected[i][j], precision);
    }
  }
}

function expectRoundTrip(h: Matrix3, src: Point[], dst: Point[], precision = 4) {
  src.forEach((p, i) => {
    const [x, y] = applyHomography(h, p);
    expect(x).toBeCloseTo(dst[i][0], precision);
    expect(y).toBeCloseTo(dst[i][1], precision);
  });
}

const fixtureSrc: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 3]];

describe('minPointsForTransform', () => {
  it('returns the keypointgui-matching minimum for each type', () => {
    const expected: Record<TransformType, number> = {
      translation: 1, rigid: 2, similarity: 2, affine: 3, homography: 4,
    };
    (Object.keys(expected) as TransformType[]).forEach((type) => {
      expect(minPointsForTransform(type)).toBe(expected[type]);
    });
  });
});

describe('estimateTranslation', () => {
  it('recovers an exact translation from a single point', () => {
    const H = estimateTranslation([[3, 4]], [[8, 1]]);
    expectMatrixClose(H, [[1, 0, 5], [0, 1, -3], [0, 0, 1]]);
  });

  it('recovers the mean translation from multiple points', () => {
    const dst = fixtureSrc.map(([x, y]): Point => [x + 5, y - 3]);
    const H = estimateTranslation(fixtureSrc, dst);
    expectMatrixClose(H, [[1, 0, 5], [0, 1, -3], [0, 0, 1]]);
  });
});

describe('estimateRigid', () => {
  it('recovers a known rotation + translation from 2 points', () => {
    const theta = Math.PI / 6;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const truth: Matrix3 = [[cos, -sin, 5], [sin, cos, -3], [0, 0, 1]];
    const src = fixtureSrc.slice(0, 2);
    const dst = src.map((p) => applyHomography(truth, p));
    const H = estimateRigid(src, dst);
    expectMatrixClose(H, truth);
    // 2x2 block is a proper rotation (unit determinant, no scale/reflection).
    const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
    expect(det).toBeCloseTo(1, 5);
  });

  it('least-squares fits a rigid transform from more than 2 noisy points', () => {
    const theta = Math.PI / 4;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const truth: Matrix3 = [[cos, -sin, 2], [sin, cos, 7], [0, 0, 1]];
    const dst = fixtureSrc.map((p) => applyHomography(truth, p));
    const H = estimateRigid(fixtureSrc, dst);
    expectRoundTrip(H, fixtureSrc, dst);
  });
});

describe('estimateSimilarity', () => {
  it('recovers a known rotation + uniform scale + translation from 2 points', () => {
    const theta = Math.PI / 3;
    const scale = 2.5;
    const cos = Math.cos(theta) * scale;
    const sin = Math.sin(theta) * scale;
    const truth: Matrix3 = [[cos, -sin, 4], [sin, cos, -6], [0, 0, 1]];
    const src = fixtureSrc.slice(0, 2);
    const dst = src.map((p) => applyHomography(truth, p));
    const H = estimateSimilarity(src, dst);
    expectMatrixClose(H, truth);
  });

  it('least-squares fits a similarity transform from more points', () => {
    const theta = -Math.PI / 5;
    const scale = 0.75;
    const cos = Math.cos(theta) * scale;
    const sin = Math.sin(theta) * scale;
    const truth: Matrix3 = [[cos, -sin, -1], [sin, cos, 3], [0, 0, 1]];
    const dst = fixtureSrc.map((p) => applyHomography(truth, p));
    const H = estimateSimilarity(fixtureSrc, dst);
    expectRoundTrip(H, fixtureSrc, dst);
  });
});

describe('estimateAffine', () => {
  const truth: Matrix3 = [[1.2, 0.3, 5], [0.1, 0.9, -4], [0, 0, 1]];

  it('recovers a known affine transform exactly from 3 non-collinear points', () => {
    const src = fixtureSrc.slice(0, 3);
    const dst = src.map((p) => applyHomography(truth, p));
    const H = estimateAffine(src, dst);
    expectMatrixClose(H, truth);
  });

  it('recovers the same affine transform from more than 3 points', () => {
    const dst = fixtureSrc.map((p) => applyHomography(truth, p));
    const H = estimateAffine(fixtureSrc, dst);
    expectMatrixClose(H, truth);
  });
});

describe('estimateTransform', () => {
  it('delegates to solveHomography for the homography type', () => {
    const truth: Matrix3 = [[1.2, 0.1, 5], [0.05, 0.9, -4], [0.0008, -0.0005, 1]];
    const src: Point[] = [[0, 0], [100, 0], [100, 80], [0, 80], [50, 40]];
    const dst = src.map((p) => applyHomography(truth, p));
    expectMatrixClose(estimateTransform('homography', src, dst), solveHomography(src, dst));
  });

  it('throws below the minimum point count for each type', () => {
    const one: Point[] = [[0, 0]];
    const two: Point[] = [[0, 0], [1, 0]];
    expect(() => estimateTransform('translation', [], [])).toThrow();
    expect(() => estimateTransform('rigid', one, one)).toThrow();
    expect(() => estimateTransform('similarity', one, one)).toThrow();
    expect(() => estimateTransform('affine', two, two)).toThrow();
    expect(() => estimateTransform('homography', fixtureSrc.slice(0, 3), fixtureSrc.slice(0, 3))).toThrow();
  });

  it('throws when src and dst lengths differ', () => {
    expect(() => estimateTransform('translation', [[0, 0]], [])).toThrow();
  });

  it('round-trips src -> dst for every transform type', () => {
    const cases: { type: TransformType; truth: Matrix3 }[] = [
      { type: 'translation', truth: [[1, 0, 5], [0, 1, -3], [0, 0, 1]] },
      { type: 'rigid', truth: [[Math.cos(0.4), -Math.sin(0.4), 1], [Math.sin(0.4), Math.cos(0.4), 2], [0, 0, 1]] },
      {
        type: 'similarity',
        truth: [[1.5 * Math.cos(0.2), -1.5 * Math.sin(0.2), 3], [1.5 * Math.sin(0.2), 1.5 * Math.cos(0.2), 4], [0, 0, 1]],
      },
      { type: 'affine', truth: [[1.1, 0.2, 2], [-0.1, 0.95, 6], [0, 0, 1]] },
      { type: 'homography', truth: [[1.2, 0.1, 5], [0.05, 0.9, -4], [0.0008, -0.0005, 1]] },
    ];
    cases.forEach(({ type, truth }) => {
      const dst = fixtureSrc.map((p) => applyHomography(truth, p));
      const H = estimateTransform(type, fixtureSrc, dst);
      expectRoundTrip(H, fixtureSrc, dst, 3);
    });
  });
});
