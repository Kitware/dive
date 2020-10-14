import Vue from 'vue';
import Vuex from 'vuex';
import Location from './Location';
import Dataset from './Dataset';

Vue.use(Vuex);

export default new Vuex.Store({
  modules: {
    Location,
    Dataset,
  },
});
