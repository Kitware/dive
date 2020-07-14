import Vue from 'vue';
import Vuex from 'vuex';
import Pipelines from './Pipelines';
import Location from './Location';
import Filetypes from './Filetypes';


Vue.use(Vuex);

export default new Vuex.Store({
  modules: {
    Pipelines,
    Location,
    Filetypes,
  },
});
