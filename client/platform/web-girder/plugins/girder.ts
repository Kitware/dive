import Vue from 'vue';
import Girder, { RestClient } from '@girder/components/src';

Vue.use(Girder);
// Attempt to get the token from the cookies or from the localStorage
const localToken = window.localStorage.getItem('girderToken');
const girderRest = new RestClient({ apiRoot: 'api/v1' });
girderRest.token = localToken || null;
export function useGirderRest() {
  return girderRest;
}

export default girderRest;
