import { ref } from 'vue';

import { NotificationBus, RestClient } from '@girder/components';

type RestClientWithCompat = RestClient & {
  $on: RestClient['on'];
  $off: RestClient['off'];
  $emit: RestClient['emit'];
};

function withRestCompat(rest: RestClient): RestClientWithCompat {
  const client = rest as RestClientWithCompat;
  client.$on = (...args) => rest.on(...args);
  client.$off = (...args) => rest.off(...args);
  client.$emit = (...args) => rest.emit(...args);
  return client;
}

function bridgeLegacyAuthEvents(rest: RestClientWithCompat) {
  rest.on('userLoggedIn', (user) => {
    rest.emit('login', user);
  });
  rest.on('userLoggedOut', () => {
    rest.emit('logout');
  });
}

function bridgeNotificationEvents(bus: NotificationBus, rest: RestClientWithCompat) {
  const forward = (event: string) => {
    bus.on(event, (payload: unknown) => {
      rest.emit(event, payload);
    });
  };
  forward('message');
  forward('message:job_status');
}

const localToken = window.localStorage.getItem('girderToken');
const girderRest = withRestCompat(new RestClient({
  apiRoot: 'api/v1',
  token: localToken || null,
}));

bridgeLegacyAuthEvents(girderRest);

const notificationBus = new NotificationBus(girderRest, {
  useWebSocket: true,
});

bridgeNotificationEvents(notificationBus, girderRest);

const girderProvide = {
  rest: girderRest,
  user: ref(girderRest.user),
  token: ref(girderRest.token),
  apiRoot: ref(girderRest.apiRoot),
};

function syncGirderProvideState() {
  girderProvide.user.value = girderRest.user;
  girderProvide.token.value = girderRest.token;
  girderProvide.apiRoot.value = girderRest.apiRoot;
}

['userLoggedIn', 'userLoggedOut', 'userRegistered', 'userFetched', 'apiRootUpdated'].forEach((event) => {
  girderRest.on(event, syncGirderProvideState);
});

export { girderProvide };

export function connectNotifications() {
  notificationBus.connect();
}

export function useGirderRest() {
  return girderRest;
}

export function getNotificationBus() {
  return notificationBus;
}

export default girderRest;
