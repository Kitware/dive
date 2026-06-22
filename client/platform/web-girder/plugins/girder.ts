import { useGirderClient, useNotificationBus } from '@girder/components';
import cookies from 'js-cookie';

function getInitialToken(): string | undefined {
  const fromStorage = window.localStorage.getItem('girderToken');
  if (fromStorage) {
    return fromStorage;
  }
  return cookies.get('girderToken') || undefined;
}

export const girder = useGirderClient({
  // Leading slash required: GWC builds ws(s)://host/notifications/me from apiRoot by
  // stripping a trailing /api/v1 segment; a relative root like "api/v1" yields an invalid URL.
  apiRoot: '/api/v1',
  token: getInitialToken(),
});

export const girderRest = girder.rest;

girderRest._axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    if (status === 401 && !url.includes('user/authentication')) {
      girderRest.token = null;
      girderRest.user = null;
      window.localStorage.removeItem('girderToken');
      cookies.remove('girderToken');
      girderRest.emit('userLoggedOut');
    }
    return Promise.reject(error);
  },
);

let notificationState: ReturnType<typeof useNotificationBus> | null = null;

function connectNotificationBus() {
  if (girderRest.user && girderRest.token) {
    notificationState?.bus.connect();
  }
}

export function initGirderNotifications() {
  notificationState = useNotificationBus(girderRest, {
    useWebSocket: true,
    listenToRestClient: false,
  });
  connectNotificationBus();
  girderRest.on('userLoggedIn', connectNotificationBus);
  girderRest.on('userFetched', connectNotificationBus);
  girderRest.on('userLoggedOut', () => {
    notificationState?.bus.disconnect();
  });
  return notificationState;
}

export function getNotificationBus() {
  if (!notificationState) {
    throw new Error('initGirderNotifications must be called before using the notification bus');
  }
  return notificationState;
}

export function useGirderRest() {
  return girderRest;
}

export default girderRest;
