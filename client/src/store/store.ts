import Vue from 'vue';
import Vuex from 'vuex';
import VuexPersistence from 'vuex-persist';
import Settings, { SettingsState } from './Settings';
import Pipelines, { PiplineState } from './Pipelines';
import Location, { LocationState } from './Location';

export interface State {
  Location: LocationState;
  Pipelines: PiplineState;
  Settings: SettingsState;
}


const vuexLocal = new VuexPersistence<State>({
  storage: window.localStorage,
  reducer: (state) => ({ Settings: state.Settings }), //only save Settings module
});
Vue.use(Vuex);

export default new Vuex.Store<State>({
  modules: {
    Settings,
    Pipelines,
    Location,
  },
  plugins: [vuexLocal.plugin],
});
