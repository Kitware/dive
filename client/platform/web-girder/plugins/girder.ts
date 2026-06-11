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
  apiRoot: 'api/v1',
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

export function initGirderNotifications() {
  notificationState = useNotificationBus(girderRest, { useWebSocket: true });
  if (girderRest.user) {
    notificationState.bus.connect();
  }
  girderRest.on('userLoggedIn', () => {
    notificationState?.bus.connect();
  });
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
