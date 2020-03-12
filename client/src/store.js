import Vue from "vue";
import Vuex from "vuex";

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    location: null,
    pipelines: []
  },
  mutations: {
    setLocation(state, location) {
      state.location = location;
    },
    setPipelines(state, pipelines) {
      state.pipelines = pipelines;
    }
  },
  actions: {}
});
