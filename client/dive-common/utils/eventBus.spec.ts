// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  describe, expect, it, vi,
} from 'vitest';

import { createEventBus } from './eventBus';

describe('EventBus', () => {
  it('supports $on, $emit, and $off', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.$on('test', handler);
    bus.$emit('test', 1, 'two');
    bus.$off('test', handler);
    bus.$emit('test', 3);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1, 'two');
  });

  it('supports multiple handlers for the same event', () => {
    const bus = createEventBus();
    const first = vi.fn();
    const second = vi.fn();

    bus.$on('multi', first);
    bus.$on('multi', second);
    bus.$emit('multi', 'payload');

    expect(first).toHaveBeenCalledWith('payload');
    expect(second).toHaveBeenCalledWith('payload');
  });
});
