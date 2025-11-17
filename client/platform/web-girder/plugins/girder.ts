import Vue from 'vue';
import Girder, { RestClient } from '@girder/components/src';
import cookies from 'js-cookie';

Vue.use(Girder);
// Attempt to get the token from the cookies or from the localStorage
const token = cookies.get('girderToken');
const localToken = window.localStorage.getItem('girderToken');
const girderRest = new RestClient({ apiRoot: 'api/v1' });
girderRest.token = token || localToken || null;
export function useGirderRest() {
  return girderRest;
}

export default girderRest;
