// @vitest-environment jsdom
import { defineComponent, ref } from 'vue';
// eslint-disable-next-line import/no-extraneous-dependencies -- @vue/test-utils is only used in tests
import { mount } from '@vue/test-utils';
import { useMediaController } from './useMediaController';
import type { AlignedFrameResolver } from './mediaControllerType';

function noop() { /* unused setVolume/setSpeed stub */ }

/**
 * useMediaController() calls Vue's provide(), so it needs a component setup()
 * context. initialize() itself (unlike initializeViewer()) never touches
 * GeoJS/DOM, so camera controllers can be registered directly here with
 * mocked seek/play/pause -- no need to mount real annotator components.
 */
function mountMediaController() {
  const seekA = vi.fn();
  const playA = vi.fn();
  const pauseA = vi.fn();
  const seekB = vi.fn();
  const playB = vi.fn();
  const pauseB = vi.fn();

  let composable!: ReturnType<typeof useMediaController>;

  const Host = defineComponent({
    setup() {
      composable = useMediaController();
      composable.initialize('A', {
        seek: seekA, play: playA, pause: pauseA, setVolume: noop, setSpeed: noop,
      });
      composable.initialize('B', {
        seek: seekB, play: playB, pause: pauseB, setVolume: noop, setSpeed: noop,
      });
      return {};
    },
    template: '<div />',
  });

  const wrapper = mount(Host);
  return {
    wrapper,
    composable,
    mocks: {
      seekA, playA, pauseA, seekB, playB, pauseB,
    },
  };
}

/**
 * Camera A is missing a frame at slot 1; camera B has one at every slot. A
 * never reports local frame 1 at all in this mock (slot 1 has no A entry,
 * and slot 2's A entry is local frame 2, not a shifted-down 1) -- so A's
 * local frame space has a hole at 1, identical to the global slot space.
 */
function makeGappedResolver(slotCount = 3, frameRate = 2): AlignedFrameResolver {
  return {
    slotCount: ref(slotCount),
    frameRate: ref(frameRate),
    resolveSlot: (f: number) => ({
      A: f === 1 ? undefined : f,
      B: f,
    }),
    resolveGlobalSlot: (camera: string, localFrame: number) => {
      if (camera === 'B') return localFrame;
      if (camera === 'A') return (localFrame === 0 || localFrame === 2) ? localFrame : undefined;
      return undefined;
    },
    gapSlots: ref([1]),
  };
}

/**
 * Camera A drops the frame at global slot 1, so unlike makeGappedResolver's
 * A, its OWN frame array is contiguous: local frame 0 is slot 0, and local
 * frame 1 (its very next captured frame) is slot 2 -- a realistic shift
 * between local and global numbering, exercising the non-trivial direction
 * of resolveGlobalSlot.
 */
function makeShiftedResolver(): AlignedFrameResolver {
  // A's own frame array only has two entries: slot 0's frame, then slot 2's.
  const aSlotForGlobalFrame: Record<number, number | undefined> = { 0: 0, 1: undefined, 2: 1 };
  const aGlobalSlotForLocalFrame: Record<number, number | undefined> = { 0: 0, 1: 2 };
  return {
    slotCount: ref(3),
    frameRate: ref(2),
    resolveSlot: (f: number) => ({
      A: aSlotForGlobalFrame[f],
      B: f,
    }),
    resolveGlobalSlot: (camera: string, localFrame: number) => {
      if (camera === 'B') return localFrame;
      if (camera === 'A') return aGlobalSlotForLocalFrame[localFrame];
      return undefined;
    },
    gapSlots: ref([1]),
  };
}

describe('useMediaController', () => {
  it('without a resolver, seek broadcasts the identical frame to every camera', () => {
    const { composable, mocks } = mountMediaController();
    composable.aggregateController.value.seek(5);
    expect(mocks.seekA).toHaveBeenCalledWith(5);
    expect(mocks.seekB).toHaveBeenCalledWith(5);
  });

  it('without a resolver, maxFrame/frame alias the first-initialized camera (today\'s behavior)', () => {
    const { composable } = mountMediaController();
    const keyA = Object.keys(composable.state)
      .find((k) => composable.state[k].cameraName === 'A');
    expect(keyA).toBeDefined();
    composable.state[keyA as string].maxFrame = 10;
    composable.state[keyA as string].frame = 4;
    expect(composable.aggregateController.value.maxFrame.value).toBe(10);
    expect(composable.aggregateController.value.frame.value).toBe(4);
  });

  it('with a resolver, seek(n) calls each camera with the resolved per-camera frame, including undefined', () => {
    const { composable, mocks } = mountMediaController();
    composable.setAlignedFrameResolver(makeGappedResolver());
    composable.aggregateController.value.seek(1);
    expect(mocks.seekA).toHaveBeenCalledWith(undefined);
    expect(mocks.seekB).toHaveBeenCalledWith(1);
    expect(composable.aggregateController.value.frame.value).toBe(1);
    expect(composable.aggregateController.value.maxFrame.value).toBe(2);
  });

  it('with a resolver, nextFrame/prevFrame advance the global slot pointer, not each camera\'s own local frame', () => {
    const { composable, mocks } = mountMediaController();
    composable.setAlignedFrameResolver(makeGappedResolver());
    composable.aggregateController.value.seek(0);
    mocks.seekA.mockClear();
    mocks.seekB.mockClear();

    composable.aggregateController.value.nextFrame();
    expect(composable.aggregateController.value.frame.value).toBe(1);
    expect(mocks.seekA).toHaveBeenLastCalledWith(undefined);
    expect(mocks.seekB).toHaveBeenLastCalledWith(1);

    composable.aggregateController.value.nextFrame();
    expect(composable.aggregateController.value.frame.value).toBe(2);
    expect(mocks.seekA).toHaveBeenLastCalledWith(2);
    expect(mocks.seekB).toHaveBeenLastCalledWith(2);

    composable.aggregateController.value.prevFrame();
    expect(composable.aggregateController.value.frame.value).toBe(1);
    expect(mocks.seekA).toHaveBeenLastCalledWith(undefined);
    expect(mocks.seekB).toHaveBeenLastCalledWith(1);
  });

  it('play() drives one centralized tick at frameRate and stops at slotCount - 1', () => {
    vi.useFakeTimers();
    try {
      const { composable, mocks } = mountMediaController();
      composable.setAlignedFrameResolver(makeGappedResolver(3, 2)); // 2fps => 500ms/tick
      composable.aggregateController.value.seek(0);
      mocks.playA.mockClear();
      mocks.playB.mockClear();

      composable.aggregateController.value.play();
      expect(mocks.playA).toHaveBeenCalledTimes(1);
      expect(mocks.playB).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(500);
      expect(composable.aggregateController.value.frame.value).toBe(1);

      vi.advanceTimersByTime(500);
      expect(composable.aggregateController.value.frame.value).toBe(2);

      mocks.pauseA.mockClear();
      mocks.pauseB.mockClear();
      vi.advanceTimersByTime(500);
      // reached slotCount - 1: auto-pauses and stops advancing
      expect(mocks.pauseA).toHaveBeenCalledTimes(1);
      expect(mocks.pauseB).toHaveBeenCalledTimes(1);
      expect(composable.aggregateController.value.frame.value).toBe(2);

      vi.advanceTimersByTime(1000);
      expect(composable.aggregateController.value.frame.value).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pause() stops the centralized tick', () => {
    vi.useFakeTimers();
    try {
      const { composable, mocks } = mountMediaController();
      composable.setAlignedFrameResolver(makeGappedResolver(10, 2));
      composable.aggregateController.value.seek(0);
      composable.aggregateController.value.play();
      vi.advanceTimersByTime(500);
      expect(composable.aggregateController.value.frame.value).toBe(1);

      composable.aggregateController.value.pause();
      expect(mocks.pauseA).toHaveBeenCalled();
      expect(mocks.pauseB).toHaveBeenCalled();

      vi.advanceTimersByTime(2000);
      expect(composable.aggregateController.value.frame.value).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a resolver, seekCameraFrame(camera, frame) is equivalent to seek(frame)', () => {
    const { composable, mocks } = mountMediaController();
    composable.aggregateController.value.seekCameraFrame('A', 5);
    expect(mocks.seekA).toHaveBeenCalledWith(5);
    expect(mocks.seekB).toHaveBeenCalledWith(5);
  });

  it('with a resolver, seekCameraFrame(camera, localFrame) translates a shifted local frame to the correct global slot', () => {
    const { composable, mocks } = mountMediaController();
    composable.setAlignedFrameResolver(makeShiftedResolver());

    // A's own local frame 1 is really global slot 2 (A dropped the frame at slot 1).
    composable.aggregateController.value.seekCameraFrame('A', 1);
    expect(composable.aggregateController.value.frame.value).toBe(2);
    expect(mocks.seekA).toHaveBeenLastCalledWith(1);
    expect(mocks.seekB).toHaveBeenLastCalledWith(2);
  });

  it('with a resolver, seekCameraFrame falls back to seeking only that camera when its local frame maps to no slot', () => {
    const { composable, mocks } = mountMediaController();
    composable.setAlignedFrameResolver(makeGappedResolver());
    mocks.seekB.mockClear();

    // A never reports local frame 1 in this resolver -- no slot maps to it.
    composable.aggregateController.value.seekCameraFrame('A', 1);
    expect(mocks.seekA).toHaveBeenLastCalledWith(1);
    expect(mocks.seekB).not.toHaveBeenCalled();
  });

  it('exposes alignedGapSlots from the resolver, empty when unaligned', () => {
    const { composable } = mountMediaController();
    expect(composable.aggregateController.value.alignedGapSlots.value).toEqual([]);

    composable.setAlignedFrameResolver(makeGappedResolver());
    expect(composable.aggregateController.value.alignedGapSlots.value).toEqual([1]);

    composable.setAlignedFrameResolver(null);
    expect(composable.aggregateController.value.alignedGapSlots.value).toEqual([]);
  });

  it('setAlignedFrameResolver(null) resets the aligned frame and hands control back to camera aliasing', () => {
    const { composable } = mountMediaController();
    composable.setAlignedFrameResolver(makeGappedResolver());
    composable.aggregateController.value.seek(2);
    expect(composable.aggregateController.value.frame.value).toBe(2);

    composable.setAlignedFrameResolver(null);
    // Falls back to the first-initialized camera's own (untouched, still 0) local frame ref.
    expect(composable.aggregateController.value.frame.value).toBe(0);
  });
});
