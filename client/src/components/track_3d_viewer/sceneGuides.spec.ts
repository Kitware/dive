import {
  depthGrid, niceStep, rigBaseline, rigCameras,
} from './sceneGuides';

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('rigCameras', () => {
  it('places only the left camera at the origin without a calibration', () => {
    const cameras = rigCameras(null, 2);
    expect(cameras.map((camera) => camera.name)).toEqual(['left']);
    expect(cameras[0].center).toEqual([0, 0, 0]);
    // The diagram lies behind the optical center, ending at depth 0
    expect(cameras[0].corners.every((corner) => corner[2] === -2)).toBe(true);
  });

  it('places the right camera at -Rt * T', () => {
    const [, right] = rigCameras({ R: identity, T: [-300, 0, 0] }, 100);
    expect(right.center).toEqual([300, 0, 0]);
    // 90 degrees about y: Xr = R * Xl puts the left x axis on the right -z axis
    const [, turned] = rigCameras({ R: [0, 0, 1, 0, 1, 0, -1, 0, 0], T: [0, 0, -300] }, 100);
    expect(turned.center.map(Math.round)).toEqual([-300, 0, 0]);
  });

  it('sizes the frustum from the intrinsics', () => {
    const [left] = rigCameras({
      R: identity,
      T: [-300, 0, 0],
      imageWidth: 2000,
      imageHeight: 1000,
      calibrations: {
        left: {
          fx: 1000, fy: 1000, cx: 1000, cy: 500,
        },
      },
    }, 10);
    expect(left.corners).toEqual([[10, 5, -10], [-10, 5, -10], [-10, -5, -10], [10, -5, -10]]);
  });

  it('matches VIAME for a measured rig', () => {
    // A real calibration; VIAME places the right camera at -Rt * T
    const [, right] = rigCameras({
      R: [
        0.999887, 0.007012, 0.013281,
        -0.006903, 0.999942, -0.008226,
        -0.013337, 0.008134, 0.999878,
      ],
      T: [-288.926, -176.928, -17.388],
    }, 100);
    expect(right.center[0]).toBeCloseTo(287.4, 0);
    expect(right.center[1]).toBeCloseTo(179.1, 0);
    expect(right.center[2]).toBeCloseTo(19.8, 0);
  });

  it('reads R given as three rows and T as a column', () => {
    const [, right] = rigCameras({
      R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      T: [[-300], [0], [0]],
    }, 100);
    expect(right.center).toEqual([300, 0, 0]);
  });

  it('ignores a malformed calibration', () => {
    expect(rigCameras({ R: [1, 0, 0], T: [1, 2, 3] }, 1)).toHaveLength(1);
    expect(rigBaseline({ R: identity, T: [3, 4, 0] })).toBe(5);
    expect(rigBaseline(null)).toBe(0);
  });
});

describe('depthGrid', () => {
  it('uses round spacing', () => {
    expect(niceStep(6000)).toBe(1000);
    expect(niceStep(3100)).toBe(500);
    expect(niceStep(1.2)).toBeCloseTo(0.2);
    expect(niceStep(0)).toBe(1);
  });

  it('spans the rig and the data, starting at the cameras', () => {
    const grid = depthGrid([-400, 1100, -100, 260, 1500, 3100], [[0, 0, 0], [300, 170, -200]]);
    expect(grid.zs).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500]);
    expect(grid.xs).toEqual([-500, 0, 500, 1000, 1500]);
    expect(grid.step).toBe(500);
    // Heights run both ways from the grid at 0 (y grows downward)
    expect(grid.ys).toEqual([-200, 0, 200, 400]);
  });

  it('marks at least three heights however flat the scene', () => {
    expect(depthGrid([0, 5000, 10, 12, 1000, 9000], []).ys).toEqual([0, 5, 10, 15]);
    expect(depthGrid([0, 5000, 40, 40, 1000, 9000], []).ys).toEqual([0, 20, 40]);
    expect(depthGrid([0, 5000, 0, 0, 1000, 9000], []).ys).toEqual([-2000, 0, 2000]);
  });
});
