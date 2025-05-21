import {
  reactive, Ref, toRefs,
} from 'vue';
import { throttle } from 'lodash';

// https://en.wikipedia.org/wiki/Flick_(time)
export const Flick = 705_600_000;

/**
 * Avoid floating point errors for common flick rates
 */
export const NTSCFlickrates: Record<string, number> = {
  '24000/1001': 29429400,
  '30000/1001': 23543520,
  '60000/1001': 11771760,
  '120000/1001': 5885880,
};

export interface Time {
  frame: Readonly<Ref<number>>;
  flick: Readonly<Ref<number>>;
  frameRate: Readonly<Ref<number>>;
  originalFps: Readonly<Ref<number | null>>;
  isPlaying: Readonly<Ref<boolean>>;
}

export type SetTimeFunc = (
  { frame, flick, playing }: { frame: number; flick: number; playing?: boolean }
) => void;

/**
 * The Time Observer is used when some privileged section
 * of the app should be allowed to set time, but the rest
 * of the general app should only read time.
 */
export default function useTimeObserver() {
  const data = reactive({
    frame: 0,
    flick: 0,
    frameRate: NaN,
    originalFps: null as number | null,
    isPlaying: false,
  });

  function initialize({ frameRate, originalFps }: {
    frameRate: number; originalFps: number | null;
  }) {
    if (typeof frameRate !== 'number') {
      throw new Error(`frameRate=${frameRate} is not a number`);
    }
    data.frameRate = frameRate;
    data.originalFps = originalFps;
  }

  const time: Time = toRefs(data);

  const updateTime: SetTimeFunc = throttle(({ frame, flick, playing }: { frame: number; flick: number, playing?: boolean }) => {
    data.frame = frame;
    data.flick = flick;
    if (playing !== undefined) {
      data.isPlaying = playing;
    }
  });

  return {
    initialize,
    updateTime,
    time,
  };
}
