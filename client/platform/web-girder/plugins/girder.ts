import Vue from 'vue';
import NotificationBus from '@girder/components/src/utils/notifications';
import Girder, { RestClient } from '@girder/components/src';

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
