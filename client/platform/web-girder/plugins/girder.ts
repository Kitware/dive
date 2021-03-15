import Vue from 'vue';
import Girder, { NotificationBus, RestClient } from '@girder/components';

Vue.use(Girder);
const girderRest = new RestClient({ apiRoot: 'api/v1' });
export const notificationBus = new NotificationBus(girderRest);

export function useGirderRest() {
  return girderRest;
}

export function useNotificationBus() {
  return notificationBus;
}

export default girderRest;
