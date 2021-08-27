import Vue from 'vue';
import Vuex from 'vuex';
import router from '../router';
import { RootState } from './types';
import Location from './Location';
import Dataset from './Dataset';
import Brand from './Brand';


Vue.use(Vuex);

const store = new Vuex.Store<RootState>({
  modules: {
    Brand,
    Location,
    Dataset,
  },
});

/* Keep location state up to date with current route */
router.beforeEach((to, from, next) => {
  if (to.name === 'home') {
    /** to.params should be LocationType */
    store.commit('Location/setLocation', to.params);
  }
  next();
});

export default store;
