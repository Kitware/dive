import { InteractiveServiceManager } from './interactive';

vi.mock('./linux', () => ({ default: {} }));
vi.mock('./windows', () => ({ default: {} }));

it('sends disconnected components and holes together without a single-polygon fallback', async () => {
  const manager = new InteractiveServiceManager();
  const sendRequest = vi.fn(async () => ({ success: true, head: [0, 0], tail: [20, 10] }));
  // Replace only the transport; exercise the public request construction.
  Object.assign(manager, { sendRequest });
  const exterior: [number, number][] = [[0, 0], [10, 0], [10, 10]];
  const polygons = [
    { exterior, holes: [] },
    { exterior: exterior.map(([x, y]): [number, number] => [x + 20, y]), holes: [] },
  ];
  await manager.polygonKeypoints(exterior, polygons);
  expect(sendRequest).toHaveBeenCalledWith({ command: 'polygon_keypoints', polygons }, 'Polygon keypoints');
  const withHole = [{ exterior, holes: [exterior] }];
  await manager.polygonKeypoints(exterior, withHole);
  expect(sendRequest).toHaveBeenLastCalledWith({ command: 'polygon_keypoints', polygons: withHole }, 'Polygon keypoints');
  await manager.polygonKeypoints(exterior, [{ exterior, holes: [] }]);
  expect(sendRequest).toHaveBeenLastCalledWith({ command: 'polygon_keypoints', polygon: exterior }, 'Polygon keypoints');
});
