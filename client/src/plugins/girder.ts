import Vue from 'vue';
import Girder, { RestClient } from '@girder/components/src';

Vue.use(Girder);
const girderRest = new RestClient({ apiRoot: 'api/v1' });

export default girderRest;
