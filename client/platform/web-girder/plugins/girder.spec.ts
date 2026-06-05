/* eslint-disable import/no-extraneous-dependencies -- vitest is a dev test runner */
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

const connect = vi.fn();
const notificationOn = vi.fn();
const restOn = vi.fn();
const restEmit = vi.fn();

vi.mock('@girder/components', () => ({
  RestClient: vi.fn().mockImplementation(() => ({
    apiRoot: 'api/v1',
    token: null,
    user: null,
    on: restOn,
    off: vi.fn(),
    emit: restEmit,
    get: vi.fn(),
    fetchUser: vi.fn(),
  })),
  NotificationBus: vi.fn().mockImplementation(() => ({
    on: notificationOn,
    off: vi.fn(),
    connect,
    disconnect: vi.fn(),
  })),
}));

describe('girder plugin', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => null),
      },
    });
    vi.resetModules();
    connect.mockClear();
    notificationOn.mockClear();
    restOn.mockClear();
    restEmit.mockClear();
  });

  it('creates NotificationBus with WebSocket enabled', async () => {
    const { NotificationBus } = await import('@girder/components');
    await import('./girder');

    expect(NotificationBus).toHaveBeenCalledWith(
      expect.anything(),
      { useWebSocket: true },
    );
  });

  it('bridges notification events to RestClient', async () => {
    await import('./girder');

    expect(notificationOn).toHaveBeenCalledWith('message', expect.any(Function));
    expect(notificationOn).toHaveBeenCalledWith('message:job_status', expect.any(Function));
  });

  it('connects notification bus via connectNotifications', async () => {
    const { connectNotifications } = await import('./girder');

    connectNotifications();

    expect(connect).toHaveBeenCalled();
  });
});
