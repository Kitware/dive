import Vue from 'vue';
import Vuex from 'vuex';
import VuexPersistence from 'vuex-persist';
import Settings from './Settings';
import Pipelines from './Pipelines';
import Location from './Location';

Vue.use(Vuex);

const vuexLocal = new VuexPersistence({
  storage: window.localStorage,
  modules:  ['Settings'],
});

export default new Vuex.Store({
  modules: {
    Settings,
    Pipelines,
    Location,
  },
  plugins: [vuexLocal.plugin],
});
