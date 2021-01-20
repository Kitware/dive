import Vue from 'vue';
import Vuex from 'vuex';
import { RootState } from './types';
import Location from './Location';
import Dataset from './Dataset';
import Brand from './Brand';

Vue.use(Vuex);

export default new Vuex.Store<RootState>({
  modules: {
    Brand,
    Location,
    Dataset,
  },
});
