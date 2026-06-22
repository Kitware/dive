import axios from 'axios';
import mitt from 'mitt';
import { vi } from 'vitest';

vi.mock('@girder/components', () => {
  function createMockRestClient(options: { apiRoot?: string; token?: string } = {}) {
    const emitter = mitt();
    const axiosInstance = axios.create();
    axiosInstance.interceptors.response.use = vi.fn();
    return {
      apiRoot: options.apiRoot || 'api/v1',
      token: options.token || null,
      user: null,
      _axios: axiosInstance,
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      fetchUser: vi.fn(),
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      $on: vi.fn().mockReturnThis(),
    };
  }

  return {
    useGirderClient: (options: object = {}) => ({ rest: createMockRestClient(options) }),
    useNotificationBus: () => ({ bus: mitt() }),
    UploadManager: class UploadManager {},
  };
});
