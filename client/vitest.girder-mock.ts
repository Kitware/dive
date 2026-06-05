import { vi } from 'vitest';

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));

vi.mock('@girder/components', () => ({
  RestClient: vi.fn().mockImplementation(() => ({
    apiRoot: 'api/v1',
    token: null,
    user: null,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    fetchUser: vi.fn(),
  })),
  NotificationBus: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
  UploadManager: vi.fn(),
  formatDate: (d: string) => new Date(d).toLocaleString(),
  formatSize: (s: number) => `${s} B`,
  formatUsername: (u: { login: string }) => u.login,
}));
