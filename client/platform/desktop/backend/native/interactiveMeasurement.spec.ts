import { InteractiveServiceManager } from './interactive';

vi.mock('./linux', () => ({ default: {} }));
vi.mock('./windows', () => ({ default: {} }));
vi.mock('./processManager', () => ({ observeChild: vi.fn() }));

it('preserves video-frame identity when forwarding a multi-point measurement', async () => {
  const manager = new InteractiveServiceManager();
  vi.spyOn(manager, 'isEnabled').mockReturnValue(true);
  const transport = manager as unknown as { sendRequest: (payload: unknown, command: string) => Promise<unknown> };
  const send = vi.spyOn(transport, 'sendRequest').mockResolvedValue({ success: true, measurement: { length: 12 } });
  const leftLine: [number, number][] = [[80, 80], [110, 110], [140, 80]];
  const rightLine: [number, number][] = [[70, 80], [100, 110], [130, 80]];
  const result = await manager.measureLine({
    leftLine, rightLine, leftImagePath: 'left.mp4', rightImagePath: 'right.mp4', frameTime: 1.25,
  });
  expect(send).toHaveBeenCalledWith({
    command: 'measure_line',
    left_line: leftLine,
    right_line: rightLine,
    left_image_path: 'left.mp4',
    right_image_path: 'right.mp4',
    frame_time: 1.25,
  }, 'measure_line');
  expect(result.measurement?.length).toBe(12);
});
